// The invite screen reads /v1/me. An old server, a signed-out phone, or a failed request stays off.
import { billingSession } from '../../../src/billing/session';
import { fetchBillingAccount } from '../../../src/sources/ompJackett';
import { phoneSourceContext } from '../searchContext';

export interface PhoneReferral {
  enabled: boolean;
  code: string;
  friends: number;
  noticeDays: number;
  noticeCredit: number;
}

const OFF: PhoneReferral = { enabled: false, code: '', friends: 0, noticeDays: 0, noticeCredit: 0 };

export function loadPhoneReferral(): Promise<PhoneReferral> {
  if (!billingSession()) return Promise.resolve(OFF);
  return fetchBillingAccount(phoneSourceContext()).then(
    (acc) => {
      const row = acc && acc.referral;
      if (!row || !row.enabled) return OFF;
      return { enabled: true, code: row.code || '', friends: row.friends || 0, noticeDays: row.noticeDays || 0, noticeCredit: row.noticeCredit || 0 };
    },
    () => OFF,
  );
}
