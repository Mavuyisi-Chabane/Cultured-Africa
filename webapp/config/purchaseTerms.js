// The numbers in the Pricing, Billing and Cancellation Policy (views/purchase-terms.ejs)
// and in the summary shown next to every Buy button. These follow the recommended
// options in the draft sent to Cultured Africa for approval (4 Oct 2026): change them
// here once the client signs off, and update POLICY_UPDATED.
module.exports = {
  POLICY_UPDATED: '4 October 2026',
  REFUND_DAYS: 7,                 // change-of-mind refund window, in days from purchase
  REFUND_MAX_MINUTES_WATCHED: 10, // ...as long as no more than this much has been watched
  REFUND_RESPONSE_BUSINESS_DAYS: 5,
  FAULT_FIX_BUSINESS_DAYS: 5,     // playback faults not fixed within this are refunded
  DEVICES_AT_ONCE: 1
};
