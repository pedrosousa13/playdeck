// The part of Storybook's own `/index.json` entry shape this harness reads.
// An entry carries `type` and `tags` too (facts verified before this plan was
// written), and they are left out rather than declared-and-unread: the type
// says what a caller may rely on, and nothing here resolves a story by either.
export interface StoryIndexEntry {
  id: string;
  title: string;
  name: string;
}

interface StoryIndexDocument {
  entries: Record<string, StoryIndexEntry>;
}

/**
 * Fetches a Storybook server's `/index.json` and flattens it to a list. Both
 * the Reely and Backpack dev servers expose this, so one function measures
 * both sides through the same code.
 */
export async function fetchStoryIndex(
  baseURL: string
): Promise<StoryIndexEntry[]> {
  const response = await fetch(`${baseURL}/index.json`);
  if (!response.ok) {
    throw new Error(
      `Fetching ${baseURL}/index.json failed with HTTP ${response.status}`
    );
  }
  const document = (await response.json()) as StoryIndexDocument;
  return Object.values(document.entries);
}
