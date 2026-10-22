// Shared unsaved-document guard. Reducers stay side-effect free, so shell
// callers route the same decision through this helper and confirm before
// dispatching navigation.

export type GuardedDocument = {
  page: string
  unsaved: boolean
}

/** A document remains guarded while it is active; dirty documents elsewhere are untouched. */
export function isNavigationBlocked(documents: readonly GuardedDocument[], activePage: string, targetPage: string): boolean {
  return activePage !== targetPage && (documents.find((document) => document.page === activePage)?.unsaved ?? false)
}
