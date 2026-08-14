import AppKit
import Foundation

struct TimedWord: Codable {
    let word: String
    let confidence: Double?
}

struct Correction: Codable {
    let wordIndex: Int
    let originalText: String
    let correctedText: String
    let confidence: Double
    let reason: String
    let status: String

    enum CodingKeys: String, CodingKey {
        case wordIndex = "word_index"
        case originalText = "original_text"
        case correctedText = "corrected_text"
        case confidence
        case reason
        case status
    }
}

func lexicalCore(_ value: String) -> String {
    value.replacingOccurrences(of: "[^A-Za-z']", with: "", options: .regularExpression)
}

func editDistance(_ left: String, _ right: String) -> Int {
    let a = Array(left)
    let b = Array(right)
    var previous = Array(0...b.count)
    for (leftIndex, leftCharacter) in a.enumerated() {
        var current = [leftIndex + 1]
        for (rightIndex, rightCharacter) in b.enumerated() {
            current.append(min(
                current[rightIndex] + 1,
                previous[rightIndex + 1] + 1,
                previous[rightIndex] + (leftCharacter == rightCharacter ? 0 : 1)
            ))
        }
        previous = current
    }
    return previous[b.count]
}

func styledReplacement(original: String, core: String, replacement: String) -> String {
    let styled = core.first?.isUppercase == true
        ? replacement.prefix(1).uppercased() + replacement.dropFirst()
        : replacement.lowercased()
    guard let range = original.range(of: core, options: [.caseInsensitive]) else { return styled }
    var result = original
    result.replaceSubrange(range, with: styled)
    return result
}

let input = FileHandle.standardInput.readDataToEndOfFile()
let words = try JSONDecoder().decode([TimedWord].self, from: input)
var trustedCounts: [String: Int] = [:]
for item in words where (item.confidence ?? 1) >= 0.78 {
    let core = lexicalCore(item.word).lowercased()
    if core.count >= 4 { trustedCounts[core, default: 0] += 1 }
}

let checker = NSSpellChecker.shared
var corrections: [Correction] = []
for (index, item) in words.enumerated() {
    guard let sourceConfidence = item.confidence, sourceConfidence < 0.55 else { continue }
    let core = lexicalCore(item.word)
    let normalized = core.lowercased()
    guard normalized.count >= 4, normalized.rangeOfCharacter(from: .letters) != nil else { continue }
    let distanceLimit = normalized.count >= 8 ? 2 : 1

    var contextual: (String, Int)?
    for (candidate, count) in trustedCounts {
        guard candidate.first == normalized.first,
              candidate != normalized,
              abs(candidate.count - normalized.count) <= distanceLimit,
              candidate.count >= 8 || count >= 2 else { continue }
        let distance = editDistance(normalized, candidate)
        guard distance <= distanceLimit else { continue }
        if contextual == nil
            || distance < contextual!.1
            || (distance == contextual!.1 && candidate < contextual!.0) {
            contextual = (candidate, distance)
        }
    }

    var replacement: String?
    var reason = ""
    var correctionConfidence = 0.0
    var status = "reverted"
    if let contextual {
        replacement = contextual.0
        reason = "Matches a high-confidence word used elsewhere in this transcript."
        correctionConfidence = min(0.94, 0.78 + Double(normalized.count - contextual.1) / Double(normalized.count) * 0.16)
        status = "applied"
    } else {
        let range = NSRange(location: 0, length: (normalized as NSString).length)
        let misspelledRange = checker.checkSpelling(of: normalized, startingAt: 0, language: "en", wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
        if misspelledRange.location != NSNotFound {
            let guesses = checker.guesses(
                forWordRange: range,
                in: normalized,
                language: "en",
                inSpellDocumentWithTag: 0
            ) ?? []
            replacement = guesses.first { guess in
                let candidate = lexicalCore(guess).lowercased()
                return candidate.first == normalized.first
                    && !candidate.isEmpty
                    && candidate != normalized
                    && editDistance(normalized, candidate) <= distanceLimit
            }
        }
        if replacement != nil {
            reason = "Suggested by the local spelling model for a low-confidence word."
            correctionConfidence = normalized.count >= 8 ? 0.78 : 0.72
        }
    }

    guard let replacement else { continue }
    let corrected = styledReplacement(original: item.word, core: core, replacement: replacement)
    guard corrected.caseInsensitiveCompare(item.word) != .orderedSame else { continue }
    corrections.append(Correction(
        wordIndex: index,
        originalText: item.word,
        correctedText: corrected,
        confidence: correctionConfidence,
        reason: reason,
        status: status
    ))
}

let output = try JSONEncoder().encode(corrections)
FileHandle.standardOutput.write(output)
