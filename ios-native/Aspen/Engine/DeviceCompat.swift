import Foundation

/// Preflight check for whether this device can run the on-device model.
/// The 3B 4-bit model needs ~2.5GB resident during load/inference; iOS kills apps
/// that exceed their memory ceiling (jetsam), which is what crashes Aspen on
/// smaller devices. We gate on total RAM and current available process memory.
enum DeviceCompat {
    /// Total physical RAM in GB.
    static var totalRAMGB: Double {
        Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824.0
    }

    /// Memory (MB) still available to THIS process before iOS jetsams it.
    /// This is the most honest signal — it reflects real headroom right now.
    static var availableMemoryMB: Double {
        Double(os_proc_available_memory()) / 1_048_576.0
    }

    /// The default model needs real headroom. Require a 6GB-class device AND
    /// enough free process memory right now. iPhone 15 Pro (8GB) passes when not
    /// under pressure; a 4GB device or a phone already starved fails.
    static var canRunDefaultModel: Bool {
        totalRAMGB >= 5.5 && availableMemoryMB >= 2600
    }

    /// A softer warning state: device is capable but currently low on free memory
    /// (other apps hogging RAM) — closing apps may help.
    static var isMemoryTight: Bool {
        totalRAMGB >= 5.5 && availableMemoryMB < 2600
    }

    /// User-facing explanation when the device can't run it.
    static var incompatibilityReason: String {
        if totalRAMGB < 5.5 {
            return "This iPhone has \(String(format: "%.0f", totalRAMGB)) GB of memory. The on-device model needs a newer iPhone (about 6 GB or more) to run without crashing. You can still connect to your Aspen box for the larger models."
        }
        return "Your iPhone is low on free memory right now. Close some background apps and try again — the model needs about 2.5 GB free to load safely."
    }
}
