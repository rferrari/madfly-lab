// Re-export the enter function and experienceInfo from the main experience file
import * as main from './iknow-blackjack.js';

// Re-export the enter function (note: the main file exports enterIknowBlackjack)
export const enterIKnowBlackjack = main.enterIKnowBlackjack;

// Re-export experienceInfo
export { experienceInfo } from './iknow-blackjack.js';
