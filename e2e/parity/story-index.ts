// The shape Storybook's own `/index.json` carries per entry (facts verified
// before this plan was written). `type`/`tags` are optional here because this
// module only ever reads `id`, `title` and `name`.
export interface StoryIndexEntry {
  id: string;
  title: string;
  name: string;
  type?: string;
  tags?: string[];
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
