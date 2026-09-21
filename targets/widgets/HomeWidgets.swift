import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Cabeçalho com as setas de seção

/// Título da seção atual e as setas ◀ ▶ que trocam de seção. As setas rodam
/// dentro da extensão (iOS 17+), sem abrir o app.
struct SectionHeader: View {
    let title: String
    /// No tamanho pequeno sobra pouca largura: título curto e setas menores.
    var compact = false

    private var arrowSize: CGFloat { compact ? 18 : 22 }

    var body: some View {
        HStack(spacing: compact ? 4 : 6) {
            WidgetSectionTitle(text: title)
            Spacer(minLength: 0)
            arrow("chevron.left", delta: -1)
            arrow("chevron.right", delta: 1)
        }
    }

    private func arrow(_ systemName: String, delta: Int) -> some View {
        Button(intent: ChangeSectionIntent(delta: delta)) {
            Image(systemName: systemName)
                .font(.system(size: compact ? 9 : 10, weight: .bold))
                .foregroundStyle(Color("accentColor"))
                .frame(width: arrowSize, height: arrowSize)
                .background(Color("cardBackground"), in: Circle())
        }
        .buttonStyle(.plain)
    }
}

/// Nome da série + "S01E14 · Contagem Regressiva".
struct EpisodeLabel: View {
    let episode: WidgetEpisode

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(episode.showName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color("textPrimary"))
                .lineLimit(1)
            Text([episode.code, episode.episodeName].compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 10))
                .foregroundStyle(Color("textSecondary"))
                .lineLimit(1)
        }
    }
}

/// Marcar assistido, nas linhas da lista.
///
/// Por fora é um círculo **vazio** com um check apagado — o mesmo desenho que
/// a watchlist do app usa para "ainda não assistido, toque para marcar". A
/// versão cheia e colorida fica só para depois do toque, senão o botão parece
/// dizer que o episódio já foi visto.
struct MarkWatchedButton: View {
    let episode: WidgetEpisode
    let consumed: Bool

    var body: some View {
        if consumed {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color("accentColor"))
        } else {
            Button(intent: MarkEpisodeWatchedIntent(episode: episode)) {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Color("textSecondary"))
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Widget

struct NextEpisodeWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NextEpisodeEntry

    private var compact: Bool { family == .systemSmall }

    private var sectionTitle: String {
        switch entry.section {
        case .watchNext:
            return compact
                ? entry.payload.text("watchNextShort", "A seguir")
                : entry.payload.text("watchNextTitle", "Assistir a seguir")
        case .upcoming:
            return compact
                ? entry.payload.text("upcomingShort", "Próximos")
                : entry.payload.text("upcomingTitle", "Próximos episódios")
        case .quiz:
            return compact
                ? entry.payload.text("quizShort", "Quiz")
                : entry.payload.text("quizTitle", "Quiz do dia")
        }
    }

    private var episodes: [WidgetEpisode] {
        entry.visibleEpisodes(limit: compact ? 1 : NextEpisodeProvider.mediumRows)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 3 : 5) {
            SectionHeader(title: sectionTitle, compact: compact)
            content
            Spacer(minLength: 0)
        }
        .widgetURL(sectionURL)
        .containerBackground(for: .widget) { Color("$widgetBackground") }
    }

    /// Para onde o toque fora dos botões leva.
    private var sectionURL: URL {
        switch entry.section {
        case .watchNext:
            // No pequeno o cartão inteiro é um episódio só: vai direto para ele.
            if compact, let first = episodes.first { return AppLink.episode(first) }
            return AppLink.watchlist
        case .upcoming:
            return AppLink.upcoming
        case .quiz:
            return AppLink.quiz
        }
    }

    @ViewBuilder
    private var content: some View {
        if entry.section == .quiz {
            quiz
        } else if episodes.isEmpty {
            EmptyWidgetMessage(title: emptyTitle, subtitle: entry.emptyHint)
        } else if compact {
            compactEpisode
        } else {
            ForEach(episodes) { episode in
                row(for: episode)
            }
        }
    }

    private var emptyTitle: String {
        guard entry.state == .ok else { return entry.payload.text("noData", "Sem dados ainda") }
        return entry.section == .watchNext
            ? entry.payload.text("noWatchNext", "Você está em dia 🎉")
            : entry.payload.text("noUpcoming", "Nenhuma estreia marcada")
    }

    // MARK: Linhas do tamanho médio

    private func row(for episode: WidgetEpisode) -> some View {
        let consumed = entry.isConsumed(episode)
        return HStack(spacing: 8) {
            Link(destination: AppLink.episode(episode)) {
                HStack(spacing: 8) {
                    PosterThumbnail(urlString: episode.posterUrl, width: 22)
                    EpisodeLabel(episode: episode)
                    Spacer(minLength: 4)
                }
            }
            if entry.section == .watchNext {
                MarkWatchedButton(episode: episode, consumed: consumed)
            } else if let countdown = Countdown.label(
                for: episode, at: entry.date, payload: entry.payload
            ) {
                Text(countdown)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color("accentColor"))
                    .lineLimit(1)
            }
        }
        .opacity(consumed ? 0.45 : 1)
    }

    // MARK: Tamanho pequeno

    @ViewBuilder
    private var compactEpisode: some View {
        if let episode = episodes.first {
            let consumed = entry.isConsumed(episode)
            VStack(alignment: .leading, spacing: 2) {
                PosterThumbnail(urlString: episode.posterUrl, width: 28)
                Text(episode.showName)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color("textPrimary"))
                    .lineLimit(2)
                Text([episode.code, episode.episodeName].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10))
                    .foregroundStyle(Color("textSecondary"))
                    .lineLimit(1)
                Spacer(minLength: 2)
                if entry.section == .watchNext {
                    compactMarkButton(for: episode, consumed: consumed)
                } else if let countdown = Countdown.label(
                    for: episode, at: entry.date, payload: entry.payload
                ) {
                    Text(countdown)
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(Color("accentColor"))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// No pequeno o botão vira uma cápsula com o verbo: "Marcar assistido"
    /// deixa claro que é uma ação, e não um selo dizendo que já foi visto.
    @ViewBuilder
    private func compactMarkButton(for episode: WidgetEpisode, consumed: Bool) -> some View {
        if consumed {
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 12))
                Text(entry.payload.text("markedWatched", "Marcado!"))
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(Color("accentColor"))
        } else {
            Button(intent: MarkEpisodeWatchedIntent(episode: episode)) {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                    Text(entry.payload.text("markWatched", "Marcar assistido"))
                        .font(.system(size: 11, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .foregroundStyle(Color("accentText"))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(Color("accentColor"), in: Capsule())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: Seção do quiz

    @ViewBuilder
    private var quiz: some View {
        if let quiz = entry.payload.quiz {
            VStack(alignment: .leading, spacing: compact ? 3 : 5) {
                if compact {
                    quizTexts(quiz)
                } else {
                    HStack(spacing: 8) {
                        Text("🎬").font(.system(size: 22))
                        quizTexts(quiz)
                    }
                }
                Spacer(minLength: 0)
                if !quiz.weekDays.isEmpty {
                    QuizWeekStrip(
                        week: quiz.weekDays,
                        showLabels: !compact,
                        dotSize: compact ? 13 : 16
                    )
                    .frame(maxWidth: .infinity, alignment: compact ? .center : .leading)
                }
                if !quiz.answeredToday && quiz.hasQuestion {
                    Link(destination: AppLink.quiz) {
                        Text(entry.payload.text("quizAnswer", "Responder"))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color("accentText"))
                            .frame(maxWidth: compact ? .infinity : nil)
                            .padding(.horizontal, compact ? 0 : 14)
                            .padding(.vertical, 6)
                            .background(Color("accentColor"), in: Capsule())
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else {
            EmptyWidgetMessage(
                title: entry.payload.text("quizTitle", "Quiz do dia"),
                subtitle: entry.emptyHint ?? entry.payload.text("quizNone", "Nenhum quiz hoje")
            )
        }
    }

    @ViewBuilder
    private func quizTexts(_ quiz: WidgetQuiz) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(quizHeadline(quiz))
                .font(.system(size: compact ? 12 : 14, weight: .semibold))
                .foregroundStyle(Color("textPrimary"))
                .lineLimit(compact ? 1 : 2)
                .minimumScaleFactor(0.85)
            if quiz.currentStreak > 0 {
                Text(
                    entry.payload.text(
                        quiz.currentStreak == 1 ? "quizStreakOne" : "quizStreakOther",
                        quiz.currentStreak == 1 ? "{n} dia seguido" : "{n} dias seguidos",
                        count: quiz.currentStreak
                    )
                )
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color("goldColor"))
                .lineLimit(1)
            }
        }
    }

    private func quizHeadline(_ quiz: WidgetQuiz) -> String {
        if !quiz.hasQuestion { return entry.payload.text("quizNone", "Nenhum quiz hoje") }
        if quiz.answeredToday { return entry.payload.text("quizDone", "Concluído hoje") }
        // No pequeno a linha é uma só: o texto curto evita virar reticências.
        return compact
            ? entry.payload.text("quizPendingShort", "Responda hoje")
            : entry.payload.text("quizPending", "Responda a pergunta de hoje")
    }
}

struct NextEpisodeWidget: Widget {
    static let kind = "NextEpisodeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: NextEpisodeProvider()) { entry in
            NextEpisodeWidgetView(entry: entry)
        }
        .configurationDisplayName("Next Episode")
        .description("O que falta assistir, as próximas estreias e o quiz do dia. Use as setas para trocar.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
