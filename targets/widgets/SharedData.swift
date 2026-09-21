import Foundation
import WidgetKit

// MARK: - Modelo (espelha src/lib/widget-data.ts)

/// Um episódio como o app publicou: tudo pronto para desenhar, sem consulta.
struct WidgetEpisode: Codable, Hashable, Identifiable {
    let showId: Int
    let showName: String
    let posterUrl: String?
    let seasonNumber: Int
    let episodeNumber: Int
    let episodeName: String?
    /// "yyyy-MM-dd" da estreia, ou nil na lista de "assistir a seguir"
    /// (aquele episódio já foi exibido, não há contagem regressiva).
    let airDate: String?

    var id: String { "\(showId)-\(seasonNumber)-\(episodeNumber)" }

    /// "S02E05" — o mesmo formato do feed e da tela de episódio no app.
    var code: String { String(format: "S%02dE%02d", seasonNumber, episodeNumber) }

    /// Meia-noite local do dia da estreia. A TMDB informa o dia, nunca a hora.
    var airDay: Date? {
        guard let airDate else { return nil }
        let formatter = DateFormatter()
        // Formato fixo: en_US_POSIX ignora o calendário e o idioma do aparelho.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.date(from: airDate)
    }
}

/// Um dia da fita da semana do quiz.
struct WidgetQuizDay: Codable, Hashable, Identifiable {
    /// "Seg", "Ter"… já no idioma do app.
    let label: String
    let answered: Bool
    let correct: Bool
    let future: Bool
    let today: Bool

    /// A semana tem um dia de cada, então o rótulo já identifica a bolinha.
    var id: String { label }
}

/// Situação do quiz do dia (espelha WidgetQuiz de src/lib/widget-data.ts).
struct WidgetQuiz: Codable {
    let hasQuestion: Bool
    let answeredToday: Bool
    let correctToday: Bool
    let currentStreak: Int
    /// Segunda a domingo da semana atual, como no card do perfil. Opcional
    /// de propósito: num app anterior a esta versão o campo não existe, e o
    /// JSONDecoder derrubaria o payload inteiro por causa de uma fita.
    let week: [WidgetQuizDay]?

    var weekDays: [WidgetQuizDay] { week ?? [] }
}

/// O JSON inteiro publicado pelo app.
struct WidgetPayload: Codable {
    let version: Int
    let updatedAt: String
    /// Textos já traduzidos: a extensão não tem i18next nem acesso ao idioma
    /// escolhido dentro do app (que pode diferir do idioma do sistema).
    let strings: [String: String]
    /// Próximas estreias das séries seguidas.
    let upcoming: [WidgetEpisode]
    /// Episódios já exibidos que faltam assistir, na ordem da watchlist.
    let watchNext: [WidgetEpisode]
    /// Nulo quando o app não conseguiu consultar o quiz nesta publicação.
    let quiz: WidgetQuiz?

    /// Texto traduzido com reserva em português, caso o app ainda não tenha
    /// publicado nada (widget recém-adicionado, antes da primeira abertura).
    func text(_ key: String, _ fallback: String) -> String {
        guard let value = strings[key], !value.isEmpty else { return fallback }
        return value
    }

    /// Mesma coisa, trocando o marcador {n} dos textos de contagem pelo número.
    func text(_ key: String, _ fallback: String, count: Int) -> String {
        text(key, fallback).replacingOccurrences(of: "{n}", with: "\(count)")
    }

    /// Os episódios de uma seção de lista. A seção Quiz não tem lista.
    func episodes(_ section: WidgetSection) -> [WidgetEpisode] {
        switch section {
        case .watchNext: return watchNext
        case .upcoming: return upcoming
        case .quiz: return []
        }
    }

    static let empty = WidgetPayload(
        version: 1,
        updatedAt: "",
        strings: [:],
        upcoming: [],
        watchNext: [],
        quiz: nil
    )

    /// Conteúdo de mentira para a pré-visualização na galeria de widgets.
    static let preview: WidgetPayload = {
        let episodes = [
            WidgetEpisode(
                showId: 1, showName: "Severance", posterUrl: nil,
                seasonNumber: 2, episodeNumber: 10, episodeName: "Cold Harbor",
                airDate: nil
            ),
            WidgetEpisode(
                showId: 2, showName: "The Last of Us", posterUrl: nil,
                seasonNumber: 2, episodeNumber: 5, episodeName: "Feel Her Love",
                airDate: nil
            ),
            WidgetEpisode(
                showId: 3, showName: "Andor", posterUrl: nil,
                seasonNumber: 2, episodeNumber: 9, episodeName: "Welcome to the Rebellion",
                airDate: nil
            ),
        ]
        return WidgetPayload(
            version: 1,
            updatedAt: "",
            strings: [:],
            upcoming: episodes,
            watchNext: episodes,
            quiz: WidgetQuiz(
                hasQuestion: true,
                answeredToday: false,
                correctToday: false,
                currentStreak: 4,
                week: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
                    .enumerated()
                    .map { index, label in
                        WidgetQuizDay(
                            label: label,
                            answered: index < 4,
                            correct: index < 4,
                            future: index > 4,
                            today: index == 4
                        )
                    }
            )
        )
    }()
}

/// Marcação de "assistido" feita no widget e ainda não enviada ao Supabase.
struct PendingWatchedEvent: Codable {
    let showId: Int
    let seasonNumber: Int
    let episodeNumber: Int
    let at: String
}

/// De onde veio (ou não veio) o conteúdo do widget. Serve para o estado vazio
/// dizer o que fazer em vez de só "nada aqui" — e, para quem desenvolve,
/// separar "o app ainda não publicou" de "o App Group não está funcionando".
enum WidgetDataState {
    case ok
    /// Nada gravado no App Group: o app não abriu ainda depois de instalar o
    /// widget, ou o entitlement do App Group não entrou neste build.
    case missing
    /// Veio conteúdo, mas não no formato que esta versão do widget entende —
    /// o app foi atualizado e o widget não (ou o contrário).
    case unreadable
}

/// As telas que o widget alterna com as setas ◀ ▶. Uma só de cada vez: em
/// widget não há rolagem, então trocar de seção é o equivalente a descer a
/// página.
enum WidgetSection: String, CaseIterable {
    case watchNext
    case upcoming
    case quiz
}

// MARK: - Armazenamento compartilhado

/// Leitura e escrita no App Group — o único canal entre o app e a extensão.
enum WidgetSharedData {
    /// Precisa bater com app.json, expo-target.config.js e o widget-bridge.
    static let appGroup = "group.com.nagibneto.nextepisode"

    private static let payloadKey = "widgetPayload"
    private static let pendingWatchedKey = "pendingWatched"
    private static let consumedKey = "consumedWatchedIds"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func loadPayload() -> (payload: WidgetPayload, state: WidgetDataState) {
        guard
            let raw = defaults?.string(forKey: payloadKey),
            let data = raw.data(using: .utf8)
        else {
            return (.empty, .missing)
        }
        guard
            let payload = try? JSONDecoder().decode(WidgetPayload.self, from: data),
            payload.version == 1
        else {
            // Formato diferente do esperado: melhor pedir atualização do que
            // desenhar errado.
            return (.empty, .unreadable)
        }
        return (payload, .ok)
    }

    // MARK: Seção atual

    private static let sectionKey = "section"

    /// Seção mostrada agora. Fora da faixa (formato antigo no App Group) volta
    /// para a primeira.
    static var section: WidgetSection {
        let index = defaults?.integer(forKey: sectionKey) ?? 0
        let all = WidgetSection.allCases
        return index >= 0 && index < all.count ? all[index] : all[0]
    }

    /// Avança/volta dando a volta: são três seções, e deixar a seta morta na
    /// última seria pior do que circular.
    static func moveSection(by delta: Int) {
        let all = WidgetSection.allCases
        let current = defaults?.integer(forKey: sectionKey) ?? 0
        let next = ((current + delta) % all.count + all.count) % all.count
        defaults?.set(next, forKey: sectionKey)
    }


    // MARK: Marcar assistido

    /// Enfileira a marcação para o app enviar ao Supabase na próxima abertura
    /// (a extensão não tem a sessão do usuário) e guarda o episódio como já
    /// respondido, para a linha mudar na hora em vez de esperar o app.
    static func markWatched(showId: Int, seasonNumber: Int, episodeNumber: Int) {
        let event = PendingWatchedEvent(
            showId: showId,
            seasonNumber: seasonNumber,
            episodeNumber: episodeNumber,
            at: ISO8601DateFormatter().string(from: Date())
        )

        var queue = decode([PendingWatchedEvent].self, key: pendingWatchedKey) ?? []
        queue.append(event)
        encode(queue, key: pendingWatchedKey)

        var consumed = consumedIds()
        let id = "\(showId)-\(seasonNumber)-\(episodeNumber)"
        if !consumed.contains(id) {
            consumed.append(id)
            encode(consumed, key: consumedKey)
        }
    }

    /// Episódios já marcados aqui no widget, aguardando a sincronização do app.
    static func consumedIds() -> [String] {
        decode([String].self, key: consumedKey) ?? []
    }

    // MARK: JSON em UserDefaults

    private static func decode<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard
            let raw = defaults?.string(forKey: key),
            let data = raw.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func encode<T: Encodable>(_ value: T, key: String) {
        guard
            let data = try? JSONEncoder().encode(value),
            let raw = String(data: data, encoding: .utf8)
        else { return }
        defaults?.set(raw, forKey: key)
    }
}
