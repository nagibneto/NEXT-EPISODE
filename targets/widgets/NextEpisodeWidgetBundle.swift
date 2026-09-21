import SwiftUI
import WidgetKit

/// Ponto de entrada da extensão. Um widget só, em dois tamanhos: as seções
/// (assistir a seguir, próximas estreias, quiz) são alternadas pelas setas
/// dentro do próprio widget, em vez de virarem entradas separadas na galeria.
@main
struct NextEpisodeWidgetBundle: WidgetBundle {
    var body: some Widget {
        NextEpisodeWidget()
    }
}
