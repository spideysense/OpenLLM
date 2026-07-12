import SwiftUI

/// Thread-safe string accumulator for streamed tokens (used by askOneShot).
final class TokenAccumulator: @unchecked Sendable {
    private var s = ""
    private let lock = NSLock()
    func append(_ t: String) { lock.lock(); s += t; lock.unlock() }
    var value: String { lock.lock(); defer { lock.unlock() }; return s }
}

private let feedbackSystemPrompt = """
You are Aspen's feedback assistant. Have a brief, warm, natural conversation (about 30-60 seconds) to learn about this user. Ask ONE short question at a time. Cover exactly three things, in order: (1) how they found Aspen; (2) why they downloaded it / what they hoped it would do; (3) whether it's serving that purpose and what else they need. React to each answer in at most one sentence before asking the next question. Keep every message to one or two short sentences. Do not lecture or pitch. After the third topic is covered, thank them warmly in one sentence and end that final message with the token [[DONE]] on its own line. Never write [[DONE]] before you are finished. Begin now with a one-line friendly intro and question 1.
"""

struct FeedbackView: View {
    @ObservedObject var vm: ChatViewModel
    @Binding var isPresented: Bool

    struct Line: Identifiable { let id = UUID(); let role: String; let text: String }
    @State private var lines: [Line] = []
    @State private var input = ""
    @State private var busy = false
    @State private var finished = false
    @State private var sessionId = "fb_" + UUID().uuidString.prefix(10).lowercased()
    @State private var turn = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("🌿 Quick question or two").font(.subheadline.weight(.semibold))
                Spacer()
                Button { post(status: "partial"); isPresented = false } label: {
                    Image(systemName: "xmark").font(.footnote)
                }.tint(.secondary)
            }.padding(14)
            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(lines) { l in
                            HStack {
                                if l.role == "user" { Spacer(minLength: 40) }
                                Text(l.text)
                                    .font(.callout)
                                    .padding(.vertical, 9).padding(.horizontal, 13)
                                    .background(l.role == "user" ? Color.accentColor : Color(.secondarySystemBackground))
                                    .foregroundColor(l.role == "user" ? .white : .primary)
                                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                                if l.role != "user" { Spacer(minLength: 40) }
                            }.id(l.id)
                        }
                        if busy { ProgressView().padding(.leading, 4).id("spinner") }
                    }.padding(14)
                }
                .onChange(of: lines.count) { _, _ in
                    if let last = lines.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }

            Divider()
            HStack(spacing: 8) {
                TextField("Type your answer…", text: $input)
                    .textFieldStyle(.roundedBorder)
                    .disabled(finished || busy)
                    .onSubmit(sendAnswer)
                Button("Send", action: sendAnswer)
                    .buttonStyle(.borderedProminent)
                    .disabled(finished || busy || input.trimmingCharacters(in: .whitespaces).isEmpty)
            }.padding(12)
        }
        .presentationDetents([.medium, .large])
        .onAppear { if lines.isEmpty { Task { await botTurn() } } }
    }

    private func transcriptTurns() -> [ChatTurn] {
        var t: [ChatTurn] = [ChatTurn(role: "system", content: feedbackSystemPrompt)]
        for l in lines { t.append(ChatTurn(role: l.role, content: l.text)) }
        return t
    }

    private func sendAnswer() {
        let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !busy, !finished else { return }
        input = ""
        lines.append(Line(role: "user", text: t))
        turn += 1
        post(status: "partial")               // progressive capture
        Task { await botTurn() }
    }

    private func botTurn() async {
        guard !busy else { return }
        busy = true
        let reply = await vm.askOneShot(transcriptTurns())
        busy = false
        var clean = reply.replacingOccurrences(of: "[[DONE]]", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        let done = reply.contains("[[DONE]]")
        if clean.isEmpty && !done { clean = "Thanks — you can also email feedback@runonaspen.com anytime." }
        if !clean.isEmpty { lines.append(Line(role: "assistant", text: clean)) }
        if done {
            finished = true
            post(status: "complete")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) { isPresented = false }
        }
    }

    private func post(status: String) {
        guard lines.contains(where: { $0.role == "user" }) || status == "partial" else { return }
        let transcript = lines.map { ["role": $0.role, "content": $0.text] }
        let payload: [String: Any] = ["sessionId": sessionId, "transcript": transcript, "status": status, "surface": "ios", "turn": turn]
        guard let url = URL(string: "https://runonaspen.com/api/feedback"),
              let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req).resume()
    }
}
