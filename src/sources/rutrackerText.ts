// Messages of the rutracker sign-in. Kept apart from the parser (rutracker.ts) so code that only compares them
// (the transfer from the phone) does not pull the parser into the LG bundle.
import { t } from '../i18n';

export const rutrackerCaptcha = (): string => t('sources.login.captcha', { name: 'RuTracker' });
export const rutrackerBadLogin = (): string => t('sources.login.badLogin');
export const rutrackerEmpty = (): string => t('sources.login.empty');
export const rutrackerNoStore = (): string => t('sources.login.noStore');
