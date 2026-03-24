class Yeastbook < Formula
  desc "TypeScript notebook powered by Bun — one command, zero config"
  homepage "https://github.com/codepawl/yeastbook"
  version "0.0.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/codepawl/yeastbook/releases/latest/download/yeastbook-macos-arm"
      sha256 "PLACEHOLDER" # Updated by CI on release
    else
      url "https://github.com/codepawl/yeastbook/releases/latest/download/yeastbook-macos-x64"
      sha256 "PLACEHOLDER" # Updated by CI on release
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/codepawl/yeastbook/releases/latest/download/yeastbook-linux-arm64"
      sha256 "PLACEHOLDER" # Updated by CI on release
    else
      url "https://github.com/codepawl/yeastbook/releases/latest/download/yeastbook-linux"
      sha256 "PLACEHOLDER" # Updated by CI on release
    end
  end

  def install
    binary_name = "yeastbook"
    # The downloaded file is the binary itself
    bin.install Dir["yeastbook-*"].first || "yeastbook" => binary_name
  end

  test do
    assert_match "Usage:", shell_output("#{bin}/yeastbook help")
  end
end
