import AppIntents
import WidgetKit

/// Setas ◀ ▶ do cabeçalho: trocam a seção mostrada (Assistir a seguir →
/// Próximos episódios → Quiz). Roda dentro da própria extensão, sem abrir o
/// app — só muda o que está guardado e manda redesenhar.
struct ChangeSectionIntent: AppIntent {
    static var title: LocalizedStringResource { "Mudar de seção" }
    /// Fora do app Atalhos: é um controle interno do widget, não uma ação que
    /// faça sentido o usuário agendar.
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Direção")
    var delta: Int

    init() {}

    init(delta: Int) {
        self.delta = delta
    }

    func perform() async throws -> some IntentResult {
        WidgetSharedData.moveSection(by: delta)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

/// Botão de marcar assistido, nas linhas de "Assistir a seguir".
///
/// A extensão não tem a sessão do Supabase, então ela não grava direto: põe a
/// marcação numa fila no App Group e o app envia assim que abrir (ver
/// syncWidgetActions em src/lib/widget-data.ts). Na tela a linha já muda para
/// o estado marcado, sem esperar.
struct MarkEpisodeWatchedIntent: AppIntent {
    static var title: LocalizedStringResource { "Marcar episódio como assistido" }
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Série")
    var showId: Int

    @Parameter(title: "Temporada")
    var seasonNumber: Int

    @Parameter(title: "Episódio")
    var episodeNumber: Int

    init() {}

    init(episode: WidgetEpisode) {
        showId = episode.showId
        seasonNumber = episode.seasonNumber
        episodeNumber = episode.episodeNumber
    }

    func perform() async throws -> some IntentResult {
        WidgetSharedData.markWatched(
            showId: showId,
            seasonNumber: seasonNumber,
            episodeNumber: episodeNumber
        )
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
