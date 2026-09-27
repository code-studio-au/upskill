export const OFFLINE_SCORM_CLOUDFRONT_ENTITLEMENT_HEADER =
  "x-upskill-offline-entitlement";
export const OFFLINE_SCORM_CLOUDFRONT_CAPABILITY_HEADER =
  "x-upskill-offline-origin-capability";

export function claimsOfflineScormCloudFrontOrigin(headers) {
  return (
    headers[OFFLINE_SCORM_CLOUDFRONT_ENTITLEMENT_HEADER] !== undefined ||
    headers[OFFLINE_SCORM_CLOUDFRONT_CAPABILITY_HEADER] !== undefined
  );
}

export function mayServeBootstrapShortcuts(headers) {
  return !claimsOfflineScormCloudFrontOrigin(headers);
}
