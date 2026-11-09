export function trackName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function shuffleTracks(paths: string[]) {
  const shuffled = [...paths];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function withTrack(paths: string[], path: string) {
  return [...new Set([...paths, path])];
}

export function withoutTrack(paths: string[], path: string) {
  return paths.filter((track) => track !== path);
}

/** The embedded title tag, or the filename when the track has none. */
export function trackTitle(path: string, tags?: { title: string | null }) {
  return tags?.title ?? trackName(path);
}
