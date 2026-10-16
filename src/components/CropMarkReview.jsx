import DecimalInput from './DecimalInput';
import { getReviewSize } from '../utils/cropMarks.js';

export default function CropMarkReview({ review, boxInfo, onEdit, onApply, onDismiss, onDetectAgain }) {
  if (!review || !boxInfo) return null;
  let size, error;
  if (review.insets) {
    try { size = getReviewSize(boxInfo.cropBox, boxInfo.rotation, review.insets); }
    catch (cause) { error = cause.message; }
  }
  return (
    <section className="print-requirements crop-mark-review" aria-label="Crop mark review">
      <strong>{review.applied ? 'Reviewed trim size' : review.detected ? 'Printed crop marks' : 'Trim review'}</strong>
      {review.status === 'scanning' ? <p className="field-help" role="status">Looking for printed crop marks…</p> : <>
        {review.status !== 'dismissed' && <>
          {size && <p className="field-help" role="status">{review.applied ? 'Reviewed trim' : 'Suggested trim (unconfirmed)'}: {(size.width / 72).toFixed(3)}″ × {(size.height / 72).toFixed(3)}″</p>}
          {review.message && <p className="field-help">{review.message}</p>}
          {review.insets && <>
            <p className="field-help">Check the orange cut line. The full page stays intact; this changes trim metadata only.</p>
            <div className="trim-inset-fields">
              {['top', 'right', 'bottom', 'left'].map(edge => <label className="select-field" key={edge}>{edge[0].toUpperCase() + edge.slice(1)} inset (in)
                <DecimalInput aria-label={`Detected trim ${edge} inset in inches`} value={review.insets[edge] / 72} onCommit={inches => onEdit({ ...review.insets, [edge]: inches * 72 })} />
              </label>)}
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
            <button type="button" className="btn btn-secondary btn-action-block" disabled={Boolean(error) || review.applied} onClick={onApply}>Use this trim size</button>
          </>}
          {!review.insets && review.status !== 'unsupported' && <button type="button" className="quiet-button" onClick={() => onEdit({ top: 0, right: 0, bottom: 0, left: 0 })}>Set trim manually</button>}
          <button type="button" className="quiet-button" onClick={onDismiss}>Dismiss trim suggestion</button>
        </>}
        <button type="button" className="quiet-button" onClick={onDetectAgain}>Detect again</button>
      </>}
    </section>
  );
}
