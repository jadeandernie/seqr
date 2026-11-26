import { HttpRequestHelper } from '../../../../shared/utils/httpRequestHelper'
import { HpoIndex, HpoVocabularyTerm, buildHpoIndex } from './hpoExtractor'

const VOCABULARY_URL = '/api/hpo_vocabulary'

let indexPromise: Promise<HpoIndex> | null = null

// The vocabulary is downloaded and indexed once per page load, and again after a failed attempt
export const loadHpoIndex = (): Promise<HpoIndex> => {
  if (!indexPromise) {
    indexPromise = new Promise<HpoIndex>((resolve, reject) => {
      new HttpRequestHelper(
        VOCABULARY_URL,
        (response: { terms: HpoVocabularyTerm[] }) => resolve(buildHpoIndex(response.terms)),
        reject,
      ).get()
    }).catch((error) => {
      indexPromise = null
      throw error
    })
  }
  return indexPromise
}

export const clearHpoIndex = () => {
  indexPromise = null
}
