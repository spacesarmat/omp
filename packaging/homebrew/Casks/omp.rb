cask "omp" do
  arch arm: "arm64", intel: "x64"

  version "0.30.0"
  sha256 arm:   "706c7966376f27117e07a34589403292258ec5e9f734755dee805bbcb82ffde0",
         intel: "b3a93a261f55c38c056d2d43e7d68366d569920a42e178976961df8c3f15e5c4"

  url "https://github.com/spacesarmat/omp/releases/download/v0.30.0/OMP-#{version}-macos-#{arch}.dmg",
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
