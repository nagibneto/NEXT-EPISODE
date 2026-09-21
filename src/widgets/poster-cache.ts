/**
 * Cartazes do widget guardados em disco (Android).
 *
 * Por que isto existe: o react-native-android-widget não tem cache nenhum de
 * imagem — ao desenhar, ele baixa cada URL remota por HTTP, de forma síncrona,
 * antes de montar a tela. E como o widget é desenhado duas vezes (tema claro e
 * escuro), cada toque numa seta custava dois downloads por cartaz. Era isso que
 * deixava a troca de seção lenta.
 *
 * Com o arquivo em disco, o lado nativo usa BitmapFactory.decodeFile e não
 * toca na rede (ver ResourceUtils.getBitmap na biblioteca).
 */

import { Directory, File, Paths } from 'expo-file-system';

const DIRECTORY_NAME = 'widget-posters';

/** O nome do arquivo na TMDB já é único ("/w185/abc123.jpg" → "abc123.jpg"). */
function fileNameFor(url: string): string | null {
  const name = url.split('/').pop();
  return name && /^[\w.-]+$/.test(name) ? name : null;
}

function directory(): Directory {
  return new Directory(Paths.cache, DIRECTORY_NAME);
}

/**
 * Garante o cartaz em disco e devolve o `file://` para o widget. Devolve a URL
 * remota original se o download falhar — melhor um desenho lento do que um
 * quadrado vazio.
 */
async function cachePoster(url: string): Promise<string> {
  const name = fileNameFor(url);
  if (!name) return url;

  try {
    const dir = directory();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

    const file = new File(dir, name);
    if (file.exists) return file.uri;

    const downloaded = await File.downloadFileAsync(url, file);
    return downloaded.uri;
  } catch {
    return url;
  }
}

/**
 * Troca as URLs remotas por caminhos locais, baixando o que ainda falta. Só o
 * primeiro uso de cada cartaz custa rede; depois é leitura de disco.
 */
export async function localizePosters(
  urls: (string | null)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(urls.filter((url): url is string => !!url))];
  const entries = await Promise.all(
    unique.map(async (url) => [url, await cachePoster(url)] as const)
  );
  return new Map(entries);
}

/**
 * Apaga os cartazes que não estão mais em uso. A pasta é pequena (algumas
 * dezenas de KB), mas sem isto ela cresceria a cada série que sai da lista.
 */
export async function prunePosters(keepUrls: (string | null)[]): Promise<void> {
  try {
    const dir = directory();
    if (!dir.exists) return;

    const keep = new Set(
      keepUrls.filter((url): url is string => !!url).map(fileNameFor).filter(Boolean)
    );
    for (const entry of dir.list()) {
      const name = entry.uri.split('/').pop();
      if (entry instanceof File && name && !keep.has(name)) entry.delete();
    }
  } catch {
    // Limpeza é acessória: falhar aqui não pode atrapalhar a publicação.
  }
}
