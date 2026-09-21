import SwiftUI
import UIKit
import WidgetKit

/// Links para dentro do app. O esquema é o "scheme" do app.json, e os
/// caminhos são as rotas do expo-router (src/app).
enum AppLink {
    private static let root = URL(string: "nextepisode:///")!

    static func url(_ path: String) -> URL {
        URL(string: "nextepisode://\(path)") ?? root
    }

    /// Aba inicial (a watchlist).
    static var watchlist: URL { root }
    static var upcoming: URL { url("/upcoming") }
    static var quiz: URL { url("/quiz") }
    static func show(_ showId: Int) -> URL { url("/show/\(showId)") }
    static func episode(_ episode: WidgetEpisode) -> URL {
        url("/episode/\(episode.showId)/\(episode.seasonNumber)/\(episode.episodeNumber)")
    }
}

/// Cartaz da série nas linhas da lista.
struct PosterThumbnail: View {
    let urlString: String?
    var width: CGFloat = 26

    var body: some View {
        Group {
            if let image = PosterCache.image(for: urlString) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Color("cardBackground")
            }
        }
        // Cartaz da TMDB é 2:3.
        .frame(width: width, height: width * 1.5)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

/// Estado vazio: seção sem conteúdo, ou app ainda não aberto.
struct EmptyWidgetMessage: View {
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color("textPrimary"))
                .lineLimit(3)
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(Color("textSecondary"))
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// Rótulo pequeno em caixa alta usado como título da seção.
struct WidgetSectionTitle: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.4)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            .foregroundStyle(Color("textSecondary"))
    }
}

/// A semana do quiz em bolinhas, no mesmo desenho do card do perfil: acerto na
/// cor de destaque, erro em vermelho, dia não respondido apagado. O dia de
/// hoje ganha um anel, e os que ainda não chegaram ficam esmaecidos.
struct QuizWeekStrip: View {
    let week: [WidgetQuizDay]
    /// No tamanho pequeno não cabe o rótulo do dia embaixo da bolinha.
    var showLabels = true
    var dotSize: CGFloat = 16

    var body: some View {
        HStack(spacing: showLabels ? 4 : 3) {
            ForEach(week) { day in
                VStack(spacing: 2) {
                    ZStack {
                        Circle()
                            .fill(background(day))
                            .frame(width: dotSize, height: dotSize)
                        if day.answered {
                            Image(systemName: day.correct ? "checkmark" : "xmark")
                                .font(.system(size: dotSize * 0.5, weight: .bold))
                                .foregroundStyle(Color("accentText"))
                        }
                    }
                    .overlay(
                        Circle().stroke(Color("textPrimary"), lineWidth: day.today ? 1.5 : 0)
                    )
                    if showLabels {
                        Text(day.label)
                            .font(.system(size: 7, weight: .medium))
                            .foregroundStyle(Color("textSecondary"))
                            .lineLimit(1)
                    }
                }
                .opacity(day.future ? 0.4 : 1)
            }
        }
    }

    private func background(_ day: WidgetQuizDay) -> Color {
        if day.correct { return Color("accentColor") }
        if day.answered { return Color("dangerColor") }
        return Color("cardBackground")
    }
}
