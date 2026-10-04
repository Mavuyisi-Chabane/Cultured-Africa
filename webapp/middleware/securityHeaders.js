// Browser security headers — the essentials a package like helmet would set, kept
// inline so the allowed third-party origins below are easy to read and change.
//
// The CSP allows exactly the CDNs the views load from (Tailwind, Font Awesome,
// Chart.js, Google Fonts) and Paystack's checkout. 'unsafe-inline' is needed because
// the views use inline <script>/<style> blocks and the Tailwind CDN injects styles.
// blob: is for the admin upload form's thumbnail-from-video preview.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://js.paystack.co https://*.paystack.co https://*.paystack.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://paystack.com https://*.paystack.co https://*.paystack.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self' https://*.paystack.co",
  "frame-src https://checkout.paystack.com https://*.paystack.co https://*.paystack.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

function securityHeaders(isProduction) {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.paystack.com")');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (isProduction) {
      // Only over real HTTPS — sending this from http://localhost would pin browsers to HTTPS.
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.removeHeader('X-Powered-By');
    next();
  };
}

module.exports = securityHeaders;
