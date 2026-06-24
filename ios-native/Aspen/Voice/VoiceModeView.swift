import SwiftUI

/// Full-screen, hands-free voice mode. Drives a continuous loop on top of the
/// existing ChatViewModel:
///   listen (live transcription) → speaker pauses → send → reply streams →
///   speak each sentence as it completes → reply done → listen again.
/// An animated orb reflects the state and reacts to the mic level.
struct VoiceModeView: View {
    @ObservedObject var vm: ChatViewModel
    @StateObject private var recognizer = SpeechRecognizer()
    @StateObject private var synth = VoiceSynthesizer()
    @Environment(\.dismiss) private var dismiss

    @State private var phase: Phase = .connecting
    @State private var spokenUpTo = 0
    @State private var pulse = false

    enum Phase { case connecting, listening, thinking, speaking, denied }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 40) {
                Spacer()
                orb
                Text(statusText)
                    .font(.title3.weight(.medium))
                    .foregroundStyle(.white.opacity(0.9))
                if phase == .listening, !recognizer.transcript.isEmpty {
                    Text(recognizer.transcript)
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.6))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .transition(.opacity)
                }
                if phase == .denied {
                    Text("Enable microphone and speech access in Settings to use voice.")
                        .font(.subheadline).foregroundStyle(.white.opacity(0.6))
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                }
                Spacer()
                Button {
                    endAll()
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(Color.white.opacity(0.12), in: Circle())
                }
                .padding(.bottom, 30)
            }
        }
        .onAppear { Task { await begin() } }
        .onDisappear { endAll() }
        .onChange(of: vm.messages.last?.content ?? "") { _, content in
            handleStreamingContent(content)
        }
        .onChange(of: vm.streaming) { _, streaming in
            if !streaming { flushRemaining() }
        }
        .onReceive(synth.$isSpeaking) { speaking in
            if speaking { withAnimation { phase = .speaking } }
            else if !vm.streaming, phase == .speaking { resumeListening() }
        }
        .onChange(of: recognizer.audioLevel) { _, _ in } // keep orb redrawing
    }

    // MARK: - orb

    private var orb: some View {
        let base: CGFloat = 150
        let scale: CGFloat = {
            switch phase {
            case .listening: return 1 + CGFloat(recognizer.audioLevel) * 0.5
            case .speaking, .thinking: return pulse ? 1.12 : 0.96
            default: return 1
            }
        }()
        return Circle()
            .fill(
                RadialGradient(
                    colors: [orbColor.opacity(0.95), orbColor.opacity(0.25)],
                    center: .center, startRadius: 4, endRadius: base
                )
            )
            .frame(width: base, height: base)
            .scaleEffect(scale)
            .animation(.easeInOut(duration: 0.18), value: recognizer.audioLevel)
            .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
            .shadow(color: orbColor.opacity(0.5), radius: 40)
            .onAppear { pulse = true }
    }

    private var orbColor: Color {
        switch phase {
        case .listening: return .green
        case .thinking:  return .orange
        case .speaking:  return .accentColor
        default:         return .gray
        }
    }

    private var statusText: String {
        switch phase {
        case .connecting: return "Starting…"
        case .listening:  return "Listening…"
        case .thinking:   return "Thinking…"
        case .speaking:   return "Speaking…"
        case .denied:     return "Microphone access needed"
        }
    }

    // MARK: - loop

    private func begin() async {
        let ok = await recognizer.requestAuth()
        guard ok, recognizer.available else { phase = .denied; return }
        recognizer.onSilence = { text in sendTranscript(text) }
        resumeListening()
    }

    private func resumeListening() {
        spokenUpTo = 0
        withAnimation { phase = .listening }
        recognizer.start()
    }

    private func sendTranscript(_ text: String) {
        recognizer.stop()
        withAnimation { phase = .thinking }
        spokenUpTo = 0
        vm.input = text
        vm.send()
    }

    /// As the assistant reply streams, speak each complete sentence the moment it
    /// finishes — so playback starts well before the full reply arrives.
    private func handleStreamingContent(_ content: String) {
        guard phase == .thinking || phase == .speaking else { return }
        let (sentences, newUpTo) = Self.extractSentences(content, from: spokenUpTo)
        spokenUpTo = newUpTo
        for s in sentences { synth.enqueue(s) }
    }

    /// Speak whatever's left after the stream ends (a final fragment with no
    /// terminal punctuation).
    private func flushRemaining() {
        guard let content = vm.messages.last?.content, content.count > spokenUpTo else { return }
        let start = content.index(content.startIndex, offsetBy: spokenUpTo)
        let tail = String(content[start...]).trimmingCharacters(in: .whitespacesAndNewlines)
        spokenUpTo = content.count
        if tail.count > 2 { synth.enqueue(tail) }
    }

    private func endAll() {
        recognizer.onSilence = nil
        recognizer.stop()
        synth.stopAll()
        vm.stop()
    }

    /// Split off complete sentences beyond `idx`; leave the trailing fragment.
    private static func extractSentences(_ content: String, from idx: Int) -> ([String], Int) {
        guard content.count > idx else { return ([], idx) }
        let start = content.index(content.startIndex, offsetBy: idx)
        let tail = String(content[start...])
        var sentences: [String] = []
        var consumed = 0
        var current = ""
        for ch in tail {
            current.append(ch)
            if ".!?\n".contains(ch) {
                let s = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if s.count > 2 { sentences.append(s) }
                consumed += current.count
                current = ""
            }
        }
        return (sentences, idx + consumed)
    }
}
