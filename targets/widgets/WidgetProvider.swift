import Foundation
import SwiftUI
import WidgetKit

/// Um instante do widget: os dados publicados mais a seção que está visível.
struct NextEpisodeEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayload
    /// A seção mostrada agora (trocada pelas setas ◀ ▶).
    let section: WidgetSection
    /// Episódios já marcados aqui no widget, esperando o app sincronizar.
    let consumedIds: [String]
    /// Se os dados chegaram, e o que dizer quando não chegaram.
    let state: WidgetDataState

    /// O que mostrar embaixo do título quando a seção está vazia.
    var emptyHint: String? {
        switch state {
        case .ok: return nil
        case .missing: return payload.text("openApp", "Abra o Next Episode")
        case .unreadable: return payload.text("updateApp", "Atualize o Next Episode")
        }
    }

    func isConsumed(_ episode: WidgetEpisode) -> Bool { consumedIds.contains(episode.id) }

    /// Os episódios da seção atual, cortados no que cabe na tela.
    func visibleEpisodes(limit: Int) -> [WidgetEpisode] {
        Array(payload.episodes(section).prefix(limit))
    }
}

struct NextEpisodeProvider: TimelineProvider {
    /// Linhas que cabem no tamanho médio.
    static let mediumRows = 3

    func placeholder(in context: Context) -> NextEpisodeEntry {
        NextEpisodeEntry(
            date: Date(),
            payload: .preview,
            section: .watchNext,
            consumedIds: [],
            state: .ok
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (NextEpisodeEntry) -> Void) {
        // Na galeria de widgets (context.isPreview) não há dados do usuário
        // ainda — mostrar a lista de exemplo vende melhor do que o vazio.
        let loaded = WidgetSharedData.loadPayload()
        completion(
            NextEpisodeEntry(
                date: Date(),
                payload: context.isPreview ? WidgetPayload.preview : loaded.payload,
                section: .watchNext,
                consumedIds: [],
                state: context.isPreview ? .ok : loaded.state
            )
        )
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextEpisodeEntry>) -> Void) {
        Task {
            let loaded = WidgetSharedData.loadPayload()
            let payload = loaded.payload

            await PosterCache.prefetch(
                payload.watchNext.map(\.posterUrl) + payload.upcoming.map(\.posterUrl)
            )

            let now = Date()
            let section = WidgetSharedData.section
            let consumedIds = WidgetSharedData.consumedIds()

            // Uma entrada por hora: a contagem regressiva ("Em 3h", "Amanhã")
            // se atualiza sozinha, sem o sistema precisar acordar a extensão.
            var entries: [NextEpisodeEntry] = []
            for hourOffset in 0..<12 {
                let date = Calendar.current.date(byAdding: .hour, value: hourOffset, to: now) ?? now
                entries.append(
                    NextEpisodeEntry(
                        date: date,
                        payload: payload,
                        section: section,
                        consumedIds: consumedIds,
                        state: loaded.state
                    )
                )
            }

            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(12 * 3600))))
        }
    }
}
