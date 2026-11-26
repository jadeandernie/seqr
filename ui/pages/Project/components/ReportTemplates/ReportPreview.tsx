import React from 'react'
import { Loader, Message } from 'semantic-ui-react'

import { Markdown } from '../../../../shared/components/panel/view-fields/TextFieldView'
import { RenderedReport } from './reportTemplateApi'

export const REPORT_PRINT_CLASS = 'report-print-area'

// Prints only the report: the page behind the modal is removed, and the report is laid out from the top of the page
const PRINT_STYLE = `
@media print {
  body > *:not(.modals) { display: none !important; }
  body * { visibility: hidden !important; }
  .ui.modals, .ui.modals > .ui.modal, .ui.modal > .content {
    position: static !important;
    display: block !important;
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    background: none !important;
    box-shadow: none !important;
  }
  .${REPORT_PRINT_CLASS}, .${REPORT_PRINT_CLASS} * { visibility: visible !important; }
  .${REPORT_PRINT_CLASS} { position: absolute !important; left: 0; top: 0; width: 100%; }
}
`

type ReportPreviewProps = {
  report?: RenderedReport | null
  errors?: string[]
  loading?: boolean
  errorHeader?: string
}

const ReportPreview = ({ report, errors, loading, errorHeader }: ReportPreviewProps) => (
  <div>
    {errors && errors.length > 0 && <Message error header={errorHeader} list={errors} />}
    {report && report.warnings.length > 0 && <Message warning list={report.warnings} />}
    <Loader active={!!loading} inline="centered" />
    {report && (
      <div className={REPORT_PRINT_CLASS}>
        <style>{PRINT_STYLE}</style>
        <Markdown>{report.markdown}</Markdown>
      </div>
    )}
  </div>
)

export default ReportPreview
