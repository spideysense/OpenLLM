import SwiftUI
import UIKit

// MARK: - Parse model

struct ParsedMessage {
    let think: String?
    let blocks: [MessageBlock]
}

struct MessageBlock: Identifiable {
    let id = UUID()
    enum Kind: Equatable {
        case text
        case code(String)       // lang ("" if none)
        case artifact(String)   // "html" | "svg"
        case mermaid
    }
    let kind: Kind
    let body: String
}

/// Splits a completed message into renderable blocks. Mirrors the web
/// MessageContent parser: pulls <think>, splits on ``` fences, routes html/svg
/// to artifacts and mermaid to a labelled card. Intentionally only run on
/// FINISHED turns — the streaming bubble stays plain text (speed commandment).
enum MessageParser {
    static let runnable: Set<String> = ["html", "svg"]

    static func parse(_ raw: String) -> ParsedMessage {
        var text = raw
        var think: String?

        if let open = text.range(of: "<think>"),
           let close = text.range(of: "</think>"),
           open.upperBound <= close.lowerBound {
            think = String(text[open.upperBound..<close.lowerBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            text.removeSubrange(open.lowerBound..<close.upperBound)
            text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        var blocks: [MessageBlock] = []
        for seg in splitFences(text) {
            if seg.isFence {
                let (lang, code) = parseFence(seg.body)
                let l = lang.lowercased()
                if l == "mermaid" {
                    blocks.append(MessageBlock(kind: .mermaid, body: code))
                } else if runnable.contains(l) {
                    blocks.append(MessageBlock(kind: .artifact(l), body: code))
                } else {
                    blocks.append(MessageBlock(kind: .code(lang), body: code))
                }
            } else if !seg.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                blocks.append(MessageBlock(kind: .text, body: seg.body))
            }
        }
        if blocks.isEmpty {
            blocks.append(MessageBlock(kind: .text, body: text))
        }
        return ParsedMessage(think: think, blocks: blocks)
    }

    private struct Segment { let isFence: Bool; let body: String }

    private static func splitFences(_ text: String) -> [Segment] {
        var segs: [Segment] = []
        var idx = text.startIndex
        while let open = text.range(of: "```", range: idx..<text.endIndex) {
            if open.lowerBound > idx {
                segs.append(Segment(isFence: false, body: String(text[idx..<open.lowerBound])))
            }
            if let close = text.range(of: "```", range: open.upperBound..<text.endIndex) {
                segs.append(Segment(isFence: true, body: String(text[open.upperBound..<close.lowerBound])))
                idx = close.upperBound
            } else {
                // Unclosed fence (rare on a completed turn) — treat the rest as code.
                segs.append(Segment(isFence: true, body: String(text[open.upperBound...])))
                idx = text.endIndex
                break
            }
        }
        if idx < text.endIndex {
            segs.append(Segment(isFence: false, body: String(text[idx...])))
        }
        return segs
    }

    /// First line is the lang only if it's a single short token (matches web).
    private static func parseFence(_ body: String) -> (String, String) {
        guard let nl = body.firstIndex(of: "\n") else { return ("", body) }
        let first = String(body[..<nl]).trimmingCharacters(in: .whitespaces)
        let rest = String(body[body.index(after: nl)...])
        if !first.isEmpty, !first.contains(" "), first.count < 20 {
            return (first, rest)
        }
        return ("", body)
    }
}

// MARK: - Render

/// Renders a completed message. Used only for finalized turns.
struct MessageContentView: View {
    let content: String
    let boxConfig: BoxClient.Config?
    @State private var openArtifact: Artifact?

    var body: some View {
        let parsed = MessageParser.parse(content)
        VStack(alignment: .leading, spacing: 8) {
            if let think = parsed.think, !think.isEmpty {
                ThinkDisclosure(text: think)
            }
            ForEach(parsed.blocks) { block in
                switch block.kind {
                case .text:
                    MarkdownText(block.body)
                case .code(let lang):
                    CodeCard(lang: lang, code: block.body)
                case .mermaid:
                    CodeCard(lang: "mermaid", code: block.body, label: "Mermaid diagram")
                case .artifact(let lang):
                    ArtifactCard(lang: lang) {
                        openArtifact = Artifact(lang: lang, code: block.body)
                    }
                }
            }
        }
        .sheet(item: $openArtifact) { art in
            ArtifactView(artifact: art, boxConfig: boxConfig)
        }
    }
}

/// Collapsible <think> content.
struct ThinkDisclosure: View {
    let text: String
    @State private var open = false
    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            Text(text)
                .font(.footnote).italic()
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        } label: {
            Label("Thinking", systemImage: "brain")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }
}

/// Tappable card that opens the artifact preview.
struct ArtifactCard: View {
    let lang: String
    let onOpen: () -> Void
    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 12) {
                Image(systemName: lang == "svg" ? "photo.artframe" : "safari")
                    .font(.title3).foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(lang == "svg" ? "SVG graphic" : "Web artifact").fontWeight(.semibold)
                    Text("Tap to open preview").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

/// Non-runnable code block with a lang label and copy button.
struct CodeCard: View {
    let lang: String
    let code: String
    var label: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(label ?? (lang.isEmpty ? "code" : lang))
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    Image(systemName: "doc.on.doc").font(.caption)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.horizontal, 12).padding(.bottom, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Light, line-based markdown: headers, bullets, numbered lists, blockquotes,
/// with inline bold/italic/code/links via AttributedString. Not a full engine
/// (tables/LaTeX deferred), but covers the prose the model actually emits.
struct MarkdownText: View {
    let raw: String
    init(_ raw: String) { self.raw = raw }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(raw.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                lineView(line)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func lineView(_ line: String) -> some View {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.isEmpty {
            Color.clear.frame(height: 2)
        } else if t.hasPrefix("### ") {
            inline(String(t.dropFirst(4))).font(.headline)
        } else if t.hasPrefix("## ") {
            inline(String(t.dropFirst(3))).font(.title3.bold())
        } else if t.hasPrefix("# ") {
            inline(String(t.dropFirst(2))).font(.title2.bold())
        } else if t.hasPrefix("> ") {
            inline(String(t.dropFirst(2)))
                .foregroundStyle(.secondary)
                .padding(.leading, 10)
                .overlay(Rectangle().frame(width: 3).foregroundStyle(.secondary.opacity(0.5)), alignment: .leading)
        } else if t.hasPrefix("- ") || t.hasPrefix("* ") {
            HStack(alignment: .top, spacing: 6) {
                Text("•")
                inline(String(t.dropFirst(2)))
            }
        } else if let r = t.range(of: #"^\d+\.\s"#, options: .regularExpression) {
            HStack(alignment: .top, spacing: 6) {
                Text(String(t[..<r.upperBound]).trimmingCharacters(in: .whitespaces))
                inline(String(t[r.upperBound...]))
            }
        } else {
            inline(line)
        }
    }

    private func inline(_ s: String) -> Text {
        if let attr = try? AttributedString(
            markdown: s,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attr)
        }
        return Text(s)
    }
}
