/**
 * Terms of Service content
 * Structured as sections for rendering in the ToS acceptance modal.
 * Source: tos.md
 */

export const TOS_LAST_UPDATED = '25 September 2025'

export interface ToSSection {
  heading?: string
  body: string
}

export const TOS_SECTIONS: ToSSection[] = [
  {
    body: `These Terms of Service (these "Terms") sets forth the terms and conditions by which you may access and use our website, www.alphix.fi (the "Website"), operated by or on behalf of Alphix (BVI) Ltd., (registration number 2163406, c/o Harneys Corporate Services Limited of Craigmuir, Chambers, P.O. Box 71, Road Town, Tortola, VG 1110, British Virgin Islands, together with its affiliates, the "Company", "we" or "us"), our App (as defined below), and any other Services provided by the Company, including any related content, tools, documentation, features and functionality (collectively the "Services"). These Terms govern your access to, use and/or interaction with the Services, the Alphix Protocol (the "Protocol"), any future governance token, the Machine Tokens, and all associated activities, including but not limited to: the Acquisition and Buy-Back of Machine Tokens (each as defined below), the holding, and/or use of Machine Tokens, and any other related actions (hereinafter collectively referred to as the "Covered Activities"). Please read these Terms carefully, as they include important information about your legal rights. By accessing or engaging in any Covered Activities, you are representing that you have (i) read, understood and agreed with these Terms; and (ii) accepted all of the terms and conditions contained in these Terms, as well as our Privacy Policy and Cookie Policy and you agree to be bound by these terms and policies. If you do not understand or agree to these Terms, you must not access or engage in any Covered Activities.`,
  },
  {
    heading: '1. The Protocol',
    body: '',
  },
  {
    heading: '1.1 The Alphix Protocol',
    body: `The Alphix Protocol consists of a set of open-source smart contracts deployed on decentralized blockchains, providing technology infrastructure for transparent, automated execution of algorithmic strategies (the "Alphix Strategies"). Each Alphix Strategy is implemented through a dedicated contract known as a "Machine". Independent third parties (the "Operators") act solely in their own capacity to execute approved strategies by issuing ERC-20 tokens ("Machine Tokens") to users who interact with a Machine. For clarity, references to the "Protocol" include those smart contracts together with any disclosed off-chain infrastructure (e.g., risk tooling, observability, integrations) maintained by contributors. The Alphix Protocol solely provides the technological foundation and platform through which independent Operators, each with specialized expertise, may acquire Machine Tokens for users.`,
  },
  {
    heading: '1.2 Machine Tokens',
    body: `Nature and Purpose: Machine Tokens are ERC-20 tokens issued on the Ethereum blockchain, serving as digital representations of voucher and credit positions relating to specific algorithmic strategies curated and administered by independent Operators utilizing the Alphix Protocol infrastructure. Each Machine Token constitutes a transferable digital unit that may be held or transferred by Users.

"Acquisition" means the issuance and delivery of new Machine Tokens to a Verified User executed via the relevant smart contracts following that user's individual on-chain interaction and completion of applicable KYC/AML checks. Machine Tokens do not constitute investor deposits or subscriptions in any collective investment scheme, mutual fund or analogous arrangement under British Virgin Islands law.

"Buyback" means the repurchase of existing Machine Tokens from Verified Users executed via the relevant smart contracts, following the Verified User's individual on-chain interaction and subject at all times to applicable KYC/AML requirements and the relevant protocol rules.

No rights in underlying assets; no pooling. Machine Tokens do not confer any claim, right or entitlement to underlying assets, yield, rewards, dividends, distributions, governance, profits, or participation in any fund, pooled investment, profit-sharing arrangement, portfolio or collective enterprise.

Regulatory character. At no time do Machine Tokens evidence or confer any ownership, equity, profit-participation, governance, voting or custodial entitlements in the Protocol, the Foundation, the Company, any Operator, or any underlying assets.

No advice; user responsibility. No guarantee or representation is made regarding the value, return or performance of Machine Tokens. Users participate entirely at their own risk.`,
  },
  {
    heading: '1.3 Operators',
    body: `Each Operator is an independent entity and is not, and shall not be deemed to be, affiliated with or acting on behalf of the Alphix Protocol, the Foundation, the Company, or any other affiliated entity, contributor, or service provider. Each Operator is responsible for the origination, development, implementation and ongoing maintenance of the algorithmic parameters, programme rules and technical controls connected to its strategy. The Operator is solely liable for its actions and operations related to Machine Token issuance and management.`,
  },
  {
    heading: '1.4 Excluded Services and Absence of Fiduciary Duties',
    body: `The Company, the Foundation, the Protocol, and the Operators do not provide, undertake, or offer any services or activities constituting custody, investment advice, portfolio management, or asset management with respect to Machine Tokens or any digital or fiat assets. In particular, no fiduciary, agency, custodial, trust, or similar relationship of any kind is created, expressed or implied, by virtue of Machine Token ownership or protocol participation.`,
  },
  {
    heading: '1.5 The Alphix Foundation',
    body: `The Alphix Foundation (the "Foundation") is constituted and operates as an ownerless Cayman Islands foundation company, without shareholders, members, or beneficiaries, and is governed in accordance with its published objects and constitutional documents. The Foundation is established exclusively for the purpose of supporting the ongoing development, maintenance, and governance of the Alphix Protocol.`,
  },
  {
    heading: '2. The Services',
    body: '',
  },
  {
    heading: '2.1 Services',
    body: `The Services offer a user interface (the "App") designed solely to display blockchain data and facilitate interactions between Users and public, permissionless smart contracts, via a non-custodial, third-party wallet application (e.g., MetaMask). The App does not accept funds, route orders, settle transactions, or operate as an intermediary or trading venue. All transactions with Machine smart contracts deployed on the Protocol, and all interactions with open-source smart contracts on decentralized blockchains, are conducted entirely and directly by Users, outside the scope or control of the App, Services, the Company or the Foundation.`,
  },
  {
    heading: '2.2 Nature of the Services and Machine Tokens',
    body: `The Services comprise access to software and interfaces. They are not investment, portfolio management, custody, fiduciary, trustee or advisory services. No trust, pooling arrangement, fund, deposit, mandate, agency or similar relationship is created between you and the Company, the Foundation, the Protocol, the Operators or their affiliates.`,
  },
  {
    heading: '2.3 Use of the Protocol',
    body: `Each Operator reserves the right, at its sole discretion, to deny, suspend, or revoke Verified User status and access. The Company and the Foundation do not participate in or assume responsibility for Operator programs, compliance, or disclosures.`,
  },
  {
    heading: '2.4 Governance',
    body: `The Protocol may employ governance using $MAK and/or vote-escrow models described in the Documentation. Such Protocol-level governance features confer no contractual rights or claims against the Company, the Foundation or the App.`,
  },
  {
    heading: '2.5 Pre-Launch Addendum',
    body: `If, at its sole discretion, an Operator elects to offer pre-launch token sales, the Pre-Launch Tokens Addendum (Annex A) forms part of these Terms and applies to such sales.`,
  },
  {
    heading: '2.6 Wallets',
    body: `Use of certain Services may require connection of a third-party digital wallet ("Wallet") to the App. Wallets are not associated with, maintained by, supported by or affiliated with the Company and/or the Foundation. You acknowledge and agree that we are not party to any transactions concluded while or after accessing our App and/or the Protocol.`,
  },
  {
    heading: '2.7 Updates; Monitoring',
    body: `We may, at our sole discretion, make any improvements, modifications or updates to the Covered Activities from time to time. Your continued access to and use of the Services are conditional on acceptance of all relevant Updates.`,
  },
  {
    heading: '2.8 Fees',
    body: `While the Company does not presently charge any fees for the Services or the App, transactions executed by you utilising data provided by the App and your use of the Services may cause you to incur fees such as blockchain gas or similar network fees, as well as fees charged by the Protocol (if any) and Third-Party Protocols.`,
  },
  {
    heading: '2.9 Regulatory Status; No Virtual Asset Services',
    body: `The Company provides a non-custodial software interface and related content. The Company does not (a) operate an exchange or order book; (b) broker, match, route or settle orders; (c) provide transfer, safekeeping, escrow, administration or custody of virtual assets or private keys; (d) accept money, virtual assets or other forms of value for transmission; or (e) participate in or provide financial services related to an issuer's offer or sale of any token or digital assets.`,
  },
  {
    heading: '2.10 No Custody; No Trust or Bailment',
    body: `The Company and the Foundation do not take custody, possession of, control, or have ability to unilaterally move any digital assets. No trust, bailment, fiduciary, or custodial relationship is created by your use of the Services.`,
  },
  {
    heading: '3. Who May Use the Covered Activities',
    body: `You must be 18 years of age or older and not be a Prohibited Person to use the Services. A "Prohibited Person" is any person or entity that is listed on any U.S. Government list of prohibited or restricted parties, the EU consolidated list of persons subject to financial sanctions, the UK Consolidated List of Financial Sanctions Targets, or any of Switzerland's sanctions lists.

Prohibited Jurisdictions include: Abkhazia, Afghanistan, Angola, Belarus, Burundi, Central African Republic, Democratic Republic of the Congo, Cuba, Crimea, Ethiopia, Guinea-Bissau, Iran, Ivory Coast, Lebanon, Liberia, Libya, Mali, Burma (Myanmar), Nicaragua, North Korea, Northern Cyprus, Russia, Somalia, Somaliland, South Ossetia, South Sudan, Sudan, Syria, Ukraine (Donetsk and Luhansk regions), United States, Venezuela, Yemen, Zimbabwe.

By using the Services, you represent that you are not a Prohibited Person and that you will not use VPNs, proxies or other technical means to circumvent any restriction.`,
  },
  {
    heading: '4. Location of Our Privacy Policy',
    body: `Our Privacy Policy describes how the Company handles information provided by Users in connection with certain Covered Activities and is hereby incorporated into these Terms by reference. For a detailed explanation of our privacy practices, please refer to the Privacy Policy located at https://app.alphix.fi/PrivacyPolicy.pdf.`,
  },
  {
    heading: '5. Data Protection',
    body: `The Company acts as a data controller for personal data it processes in connection with the Website, the App/UI, acceptance logging, security and compliance controls, and user communications. Public blockchains are public, append-only ledgers operated by third parties. The Company does not control those networks and cannot delete, amend or conceal on-chain records.

You agree the Company may collect and retain acceptance logs (timestamp, IP address, device metadata and wallet address and/or signed wallet message) as evidence of your acceptance of these Terms.

Subject to conditions, UK/EEA users may have rights to access, rectification, erasure (subject to blockchain constraints), restriction, objection, portability, and to withdraw consent.`,
  },
  {
    heading: '6. Rights We Grant You',
    body: `We grant you a limited, revocable, personal, non-commercial, non-exclusive, non-transferable, non-assignable and non-sublicensable licence to access, use and display the Services. All rights not expressly granted are reserved.

You may not: download, modify, copy, distribute content from the Services; duplicate, decompile, reverse engineer or disassemble the Services; use automation software (bots); access or use the Services in any manner that could disable or overburden them; attempt to gain unauthorised access to the Services; circumvent any technological protections; introduce malicious materials; or violate any applicable law or regulation.`,
  },
  {
    heading: '7. Ownership and Content',
    body: `The Services, including their "look and feel", proprietary content, information and other materials, are protected under copyright, trademark and other intellectual property laws. We and our licensors reserve all rights in connection with the Services and its content.`,
  },
  {
    heading: '8. Third-Party Services and Materials',
    body: `The Covered Activities may provide data relevant to Third-Party Protocols. The Company does not endorse any Third-Party Materials. You agree that your access and use of such Third-Party Protocols is governed solely by their own terms and conditions.`,
  },
  {
    heading: '9. Disclaimers, Limitations of Liability and Indemnification',
    body: `Your access to and use of the Covered Activities are at your own risk. The Covered Activities are provided on an "AS IS" and "AS AVAILABLE" basis. To the maximum extent permitted by applicable law, the Company Entities disclaim all warranties, conditions and representations, whether express, implied or statutory.

TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE ALPHIX PARTIES AND RELATED PARTIES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS INTERRUPTION, ARISING OUT OF OR RELATING TO THE SERVICES OR COVERED ACTIVITIES, UNDER ANY THEORY OF LIABILITY.

TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE AGGREGATE LIABILITY OF THE ALPHIX PARTIES SHALL NOT EXCEED THE GREATER OF (i) THE FEES ACTUALLY PAID BY YOU TO THE ALPHIX ASSOCIATION IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (ii) USD 100.

Nothing in these Terms limits liability for fraud, wilful misconduct, or any liability that cannot be lawfully excluded.`,
  },
  {
    heading: '9.4 Assumption of Risks',
    body: `You acknowledge that interacting with blockchain technology, smart contracts, and digital assets involves significant risks, including but not limited to:
\u2022 loss of private keys or wallet access;
\u2022 smart contract vulnerabilities or exploits;
\u2022 irreversible transactions;
\u2022 regulatory or tax uncertainty;
\u2022 price volatility and liquidity risk;
\u2022 protocol upgrades, pauses, or parameter changes;
\u2022 reliance on third-party infrastructure and public networks.

Certain aspects of the Protocol may be subject to control by multisignature wallets or governance mechanisms, including pausing, upgrades, or parameter adjustments. Such controls may be exercised by persons not under the control of the Alphix Association.

You accept that the Protocol may not be fully decentralised at all times and that risks may evolve over time.`,
  },
  {
    heading: '9.5 Indemnification',
    body: `You agree to defend, indemnify, and hold harmless the Alphix Parties and Related Parties from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys\u2019 fees) arising out of or relating to:
a. your breach of these Terms or applicable law;
b. your misuse of the Services or Covered Activities;
c. your violation of any third-party rights; or
d. your negligence or wilful misconduct.

The Alphix Association reserves the right to control the defence and settlement of any claim subject to indemnification, and you agree to cooperate fully.`,
  },
  {
    heading: '10. No Third-Party Beneficiaries',
    body: `These Terms are solely for the benefit of you and the Alphix Association. No other person or entity shall be deemed a third-party beneficiary of these Terms.`,
  },
  {
    heading: '11. Governing Law; Dispute Resolution',
    body: `These Terms and any non-contractual obligations arising from them are governed by the laws of Switzerland, without regard to conflict-of-laws principles.

Any dispute arising out of or relating to these Terms or the Services shall be subject to the exclusive jurisdiction of the competent courts of the Canton of Zug, Switzerland.`,
  },
  {
    heading: '12. Miscellaneous',
    body: `If any provision of these Terms is held invalid or unenforceable, the remaining provisions shall remain in full force and effect. Failure to enforce any right shall not constitute a waiver.

You may not assign or transfer these Terms without prior written consent. We may assign these Terms as part of a restructuring or reorganization.

By using the App, you acknowledge that you understand and accept the risks of digital assets and agree that the Company shall not be liable for any losses incurred.`,
  },
]

/**
 * The exact message to be signed by the user's wallet when accepting the ToS.
 */
export const TOS_SIGNATURE_MESSAGE = `I accept the Terms of Service, listed at https://app.alphix.fi/ToS.pdf. I acknowledge that I am not a citizen or resident of a Prohibited Jurisdiction, as defined in the Terms of Service, proof of which may be required for any potential rewards available in the future.`
