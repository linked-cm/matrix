/**
 * Registers this ontology.
 *
 * Kept out of `matrix.ts` because registration needs that module's whole export namespace, and a
 * module cannot import itself once a bundler is involved: Rollup treats a static self-reference
 * as a circular import and elides it, so the binding is undefined at runtime.
 */
import * as terms from './matrix.js';
import { dataFiles, loadData, ns } from './matrix.js';
import { linkedOntology } from '../package.js';

linkedOntology(terms, ns, 'matrix', loadData, dataFiles);
