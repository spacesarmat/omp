cask "omp" do
  arch arm: "arm64", intel: "x64"

  version "0.30.4"
  sha256 arm:   "78d5f8177f9f082f69ea03731b9dca2e1ced8eee1b7bf18dc8c65fd0ffad168f",
         intel: "df1f85863d65928e1911a6d0c958b7273959e021c755891b22f6330c8f76aa8e"

  url "https://github.com/spacesarmat/omp/releases/download/v0.30.4/OMP-#{version}-macos-#{arch}.dmg",
      verified: "github.com/spacesarmat/omp/"
  name "OMP"
  desc "Media player for TorrServer"
  homepage "https://omp-player.online"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :big_sur"

  app "OMP.app"

  zap trash: [
    "~/Library/Application Support/com.spacesarmat.omp.desktop",
    "~/Library/Caches/com.spacesarmat.omp.desktop",
    "~/Library/Preferences/com.spacesarmat.omp.desktop.plist",
  ]

  caveats do
    "OMP is not signed with an Apple Developer ID. Open it with a right click and Open, or allow it in Privacy and Security."
  end
end
