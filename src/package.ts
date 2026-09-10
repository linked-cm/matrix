import { linkedPackage } from '@_linked/core/utils/Package';

/** Official first-party package identity for the Matrix transport. */
export const matrixPackageName = '@_linked/matrix' as const;
export const matrixPackageBaseUri = 'https://linked.cm/' as const;

const registration = linkedPackage(matrixPackageName, {
  baseUri: matrixPackageBaseUri,
});

export const {
  getPackageShape,
  linkedOntology,
  linkedShape,
  linkedUtil,
  packageExports,
  packageMetadata,
  registerPackageExport,
  registerPackageModule,
} = registration;

export const packageName = registration.packageName;
