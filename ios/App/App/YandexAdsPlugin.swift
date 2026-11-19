import Capacitor
import UIKit
import WebKit
import YandexMobileAds

// Native Yandex ads for the iOS phone app. The page reserves a card-sized cell; this plugin binds a
// NativeAdView over it. No fill or a bind error rejects the call so the page can show an own banner.
// Add NSUserTrackingUsageDescription before shipping a store build:
// "Идентификатор нужен, чтобы показывать рекламу в разделах Мои и Обзор. История просмотра не отправляется."
@objc(YandexAdsPlugin)
public class YandexAdsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "YandexAdsPlugin"
    public let jsName = "YandexAds"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "place", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideAll", returnType: CAPPluginReturnPromise),
    ]

    private final class Slot {
        let loader: NativeAdLoader
        let ad: NativeAd
        let view: OmpNativeAdView
        init(loader: NativeAdLoader, ad: NativeAd, view: OmpNativeAdView) {
            self.loader = loader
            self.ad = ad
            self.view = view
        }
    }

    private var slots: [String: Slot] = [:]
    private let unitRe = try! NSRegularExpression(pattern: "^(?:R-M-[0-9A-Za-z-]{1,40}|demo-native-content-yandex|demo-native-app-yandex)$")

    @objc func load(_ call: CAPPluginCall) {
        guard let slotId = call.getString("slotId")?.trimmingCharacters(in: .whitespacesAndNewlines), !slotId.isEmpty, slotId.count <= 80 else {
            call.reject("bad-slot")
            return
        }
        guard let unit = call.getString("adUnitId")?.trimmingCharacters(in: .whitespacesAndNewlines), accept(unit) else {
            call.reject("bad-unit")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.reject("gone")
                return
            }
            let loader = NativeAdLoader()
            let request = AdRequest(adUnitID: unit)
            loader.loadAd(with: request, options: NativeAdOptions()) { [weak self] result in
                DispatchQueue.main.async {
                    guard let self = self else {
                        call.reject("gone")
                        return
                    }
                    switch result {
                    case .success(let ad):
                        let view = OmpNativeAdView()
                        ad.delegate = nil
                        do {
                            try ad.bind(with: view)
                            self.slots[slotId]?.view.removeFromSuperview()
                            self.slots[slotId] = Slot(loader: loader, ad: ad, view: view)
                            if view.sponsoredLabel?.text?.isEmpty != false {
                                view.sponsoredLabel?.text = "Реклама"
                            }
                            call.resolve()
                        } catch {
                            call.reject("bind")
                        }
                    case .failure:
                        call.reject("nofill")
                    }
                }
            }
        }
    }

    @objc func place(_ call: CAPPluginCall) {
        guard let slotId = call.getString("slotId"),
              let x = call.getDouble("x"),
              let y = call.getDouble("y"),
              let width = call.getDouble("width"),
              let height = call.getDouble("height"),
              let viewport = call.getDouble("viewportWidth") else {
            call.reject("bad-rect")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let slot = self.slots[slotId], let web = self.bridge?.webView else {
                call.reject("gone")
                return
            }
            guard let host = self.host(over: web) else {
                call.reject("no-host")
                return
            }
            let scale = viewport > 0 ? web.bounds.width / CGFloat(viewport) : 1
            if slot.view.superview !== host {
                slot.view.removeFromSuperview()
                host.addSubview(slot.view)
            }
            let origin = web.convert(CGPoint.zero, to: host)
            slot.view.frame = CGRect(
                x: origin.x + CGFloat(x) * scale,
                y: origin.y + CGFloat(y) * scale,
                width: max(1, CGFloat(width) * scale),
                height: max(1, CGFloat(height) * scale)
            )
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        guard let slotId = call.getString("slotId") else {
            call.reject("bad-slot")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.slots.removeValue(forKey: slotId)?.view.removeFromSuperview()
            call.resolve()
        }
    }

    @objc func hideAll(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.slots.values.forEach { $0.view.removeFromSuperview() }
            self?.slots.removeAll()
            call.resolve()
        }
    }

    private func accept(_ raw: String) -> Bool {
        let range = NSRange(raw.startIndex..<raw.endIndex, in: raw)
        return unitRe.firstMatch(in: raw, options: [], range: range) != nil
    }

    private func host(over web: WKWebView) -> UIView? {
        guard let parent = web.superview else { return nil }
        if let existing = parent.viewWithTag(8_160_042) { return existing }
        let host = PassThroughView(frame: parent.bounds)
        host.tag = 8_160_042
        host.backgroundColor = .clear
        host.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        parent.addSubview(host)
        return host
    }
}

// Touches outside an ad card fall through to the page. The ad view itself stays clickable.
final class PassThroughView: UIView {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        for sub in subviews where !sub.isHidden && sub.alpha > 0 && sub.point(inside: convert(point, to: sub), with: event) {
            return true
        }
        return false
    }
}

// Every asset Yandex marks as required is linked. Empty optional labels stay in the tree so the bind succeeds.
final class OmpNativeAdView: NativeAdView {
    private let media = MediaView()
    private let title = UILabel()
    private let body = UILabel()
    private let domain = UILabel()
    private let sponsored = UILabel()
    private let warning = UILabel()
    private let price = UILabel()
    private let reviews = UILabel()
    private let age = UILabel()
    private let icon = UIImageView()
    private let favicon = UIImageView()
    private let feedback = UIButton(type: .infoLight)
    private let action = UIButton(type: .system)
    private let rating = RatingView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.086, green: 0.094, blue: 0.114, alpha: 1)
        title.textColor = UIColor(red: 0.957, green: 0.945, blue: 0.918, alpha: 1)
        title.font = .boldSystemFont(ofSize: 14)
        title.numberOfLines = 2
        body.textColor = UIColor(red: 0.784, green: 0.769, blue: 0.729, alpha: 1)
        body.font = .systemFont(ofSize: 12)
        body.numberOfLines = 2
        domain.textColor = UIColor(red: 0.663, green: 0.643, blue: 0.604, alpha: 1)
        domain.font = .systemFont(ofSize: 11)
        sponsored.text = "Реклама"
        sponsored.textColor = UIColor(red: 0.906, green: 0.694, blue: 0.353, alpha: 1)
        sponsored.font = .boldSystemFont(ofSize: 11)
        warning.font = .systemFont(ofSize: 10)
        warning.textColor = domain.textColor
        warning.numberOfLines = 3
        for label in [price, reviews, age] {
            label.font = .systemFont(ofSize: 10)
            label.textColor = domain.textColor
        }
        media.translatesAutoresizingMaskIntoConstraints = false
        addSubview(media)
        addSubview(title)
        addSubview(body)
        addSubview(domain)
        addSubview(sponsored)
        addSubview(warning)
        addSubview(price)
        addSubview(reviews)
        addSubview(age)
        addSubview(icon)
        addSubview(favicon)
        addSubview(feedback)
        addSubview(action)
        addSubview(rating)
        mediaView = media
        titleLabel = title
        bodyLabel = body
        domainLabel = domain
        sponsoredLabel = sponsored
        warningLabel = warning
        priceLabel = price
        reviewCountLabel = reviews
        ageLabel = age
        iconImageView = icon
        feedbackButton = feedback
        callToActionButton = action
        ratingView = rating
    }

    required init?(coder: NSCoder) {
        return nil
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let pad: CGFloat = 8
        let textTop = bounds.height * 0.62
        sponsored.frame = CGRect(x: pad, y: pad, width: 72, height: 16)
        media.frame = CGRect(x: 0, y: 0, width: bounds.width, height: max(40, textTop - 4))
        title.frame = CGRect(x: pad, y: textTop, width: bounds.width - pad * 2, height: 36)
        body.frame = CGRect(x: pad, y: textTop + 36, width: bounds.width - pad * 2, height: 32)
        domain.frame = CGRect(x: pad, y: bounds.height - 28, width: bounds.width - 48, height: 16)
        feedback.frame = CGRect(x: bounds.width - 36, y: bounds.height - 36, width: 32, height: 32)
        warning.frame = CGRect(x: pad, y: textTop + 70, width: bounds.width - pad * 2, height: 28)
        action.frame = CGRect(x: pad, y: bounds.height - 48, width: 120, height: 18)
        icon.frame = CGRect(x: pad, y: pad + 20, width: 16, height: 16)
        favicon.frame = CGRect(x: pad + 20, y: pad + 22, width: 12, height: 12)
        age.frame = CGRect(x: pad + 36, y: pad + 20, width: 40, height: 14)
        price.frame = CGRect(x: pad, y: textTop + 68, width: 80, height: 14)
        reviews.frame = CGRect(x: pad + 84, y: textTop + 68, width: 80, height: 14)
        rating.frame = CGRect(x: bounds.width - 80, y: pad, width: 72, height: 16)
    }
}
