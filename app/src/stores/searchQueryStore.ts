import { create } from 'zustand'

interface SearchQueryStore {
  query: string
  setQuery: (query: string) => void
}

/**
 * Live text from the shell's search field — mirrors shell_state.dart's
 * searchQueryProvider. AppSidebar's tool-list pane filters against this.
 */
export const useSearchQueryStore = create<SearchQueryStore>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}))
