// Re-export the enter function and experienceInfo from the main experience file
import * as main from './optogenetics-palette.js';

// Re-export the enter function (note: the main file exports enterOptogenetics)
export const enterOptogenetics = main.enterOptogenetics;

// Re-export experienceInfo
export { experienceInfo } from './optogenetics-palette.js';
