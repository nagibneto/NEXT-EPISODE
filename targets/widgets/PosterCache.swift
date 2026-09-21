import Foundation
import UIKit

/// Cartazes das séries, guardados em arquivo dentro do App Group.
///
/// A View de um widget é desenhada de forma síncrona e não pode esperar um
/// download. Então o provider baixa o que falta enquanto monta o timeline
/// (`getTimeline` é assíncrono) e a View só lê o arquivo que já está no disco.
enum PosterCache {
    /// Teto de quantos cartazes um timeline baixa de uma vez — o bastante
    /// para todas as páginas das duas listas, já que virar a página não dá
    /// tempo de baixar nada. Só ocupa disco: a imagem é lida ao desenhar.
    static let downloadLimit = 14

    private static var directory: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: WidgetSharedData.appGroup)?
            .appendingPathComponent("posters", isDirectory: true)
    }

    /// O nome do arquivo da TMDB já é único ("/w185/abc123.jpg" → "abc123.jpg").
    private static func file(for urlString: String) -> URL? {
        guard let url = URL(string: urlString), !url.lastPathComponent.isEmpty else { return nil }
        return directory?.appendingPathComponent(url.lastPathComponent)
    }

    /// Cartaz pronto para desenhar, ou nil enquanto o download não terminou.
    static func image(for urlString: String?) -> UIImage? {
        guard let urlString, let file = file(for: urlString) else { return nil }
        return UIImage(contentsOfFile: file.path)
    }

    /// Baixa o que ainda não está em disco. Falhas são ignoradas de propósito:
    /// sem cartaz o widget desenha o cartão só com texto.
    static func prefetch(_ urlStrings: [String?]) async {
        let pending = urlStrings
            .compactMap { $0 }
            .reduce(into: [String]()) { unique, url in
                if !unique.contains(url) { unique.append(url) }
            }
            .prefix(downloadLimit)
            .filter { urlString in
                guard let file = file(for: urlString) else { return false }
                return !FileManager.default.fileExists(atPath: file.path)
            }

        guard !pending.isEmpty, let directory = directory else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        await withTaskGroup(of: Void.self) { group in
            for urlString in pending {
                group.addTask {
                    guard
                        let url = URL(string: urlString),
                        let file = file(for: urlString),
                        let (data, _) = try? await URLSession.shared.data(from: url),
                        UIImage(data: data) != nil
                    else { return }
                    try? data.write(to: file)
                }
            }
        }
    }
}
