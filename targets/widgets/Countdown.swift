import Foundation

/// Quanto falta para a estreia, em texto curto.
///
/// A TMDB só informa o dia da exibição, nunca a hora — então a conta é sempre
/// até a meia-noite local daquele dia. Por isso as horas só aparecem na reta
/// final (menos de 6h): antes disso "Amanhã" é mais honesto do que "Em 19h".
enum Countdown {
    private static let hour: TimeInterval = 3600
    private static let sixHours: TimeInterval = 6 * 3600

    /// "Hoje!", "Em 40min", "Em 3h", "Amanhã", "Em 12 dias".
    static func label(for episode: WidgetEpisode, at now: Date, payload: WidgetPayload) -> String? {
        guard let airDay = episode.airDay else { return nil }

        let calendar = Calendar.current
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: airDay)
        ).day ?? 0

        if days <= 0 { return payload.text("today", "Hoje!") }

        let interval = airDay.timeIntervalSince(now)
        if interval < hour {
            let minutes = max(1, Int(interval / 60))
            return fill(payload.text("inMinutes", "Em {n}min"), minutes)
        }
        if interval < sixHours {
            return fill(payload.text("inHours", "Em {n}h"), Int(interval / hour))
        }
        if days == 1 { return payload.text("tomorrow", "Amanhã") }
        return fill(payload.text("inDays", "Em {n} dias"), days)
    }

    /// Os textos vêm dos JSON de tradução com o marcador {n} no lugar do número.
    private static func fill(_ template: String, _ value: Int) -> String {
        template.replacingOccurrences(of: "{n}", with: "\(value)")
    }
}
