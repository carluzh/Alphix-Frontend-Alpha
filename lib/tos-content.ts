/**
 * Terms of Service content
 * Structured as sections for rendering in the ToS acceptance modal.
 * Source: TERMS_OF_SERVICE.pdf (Last Revised: 4 February 2026)
 */

export const TOS_LAST_UPDATED = '4 February 2026'

/** Semantic version string used for localStorage + Redis versioning */
export const TOS_VERSION = '2026-02-04'

export interface ToSSection {
  heading?: string
  body: string
}

export const TOS_SECTIONS: ToSSection[] = [
  {
    body: `These Terms of Service (these "Terms") set forth the terms and conditions by which you may access and use our website, www.alphix.fi (the "Website"), operated by or on behalf of Alphix Association, a Swiss association with its seat in the Canton of Zug (together with its affiliates, contributors, and service providers, the "Association," "we," or "us"), our App (as defined below), and any other Services provided by the Association, including any related content, tools, documentation, features and functionality (collectively the "Services").

These Terms govern your access to, use and/or interaction with the Services, the Alphix Protocol (the "Protocol"), any future governance mechanisms, tokens, or digital assets associated with the Protocol, and all related activities, including but not limited to the acquisition, holding, use, or interaction with such digital assets and the Protocol (hereinafter collectively referred to as the "Covered Activities").

Please read these Terms carefully, as they include important information about your legal rights. By accessing or engaging in any Covered Activities, you represent that you have (i) read, understood and agreed with these Terms and (ii) accepted all of the terms and conditions contained in these Terms, as well as our Privacy Policy, and you agree to be bound by these terms and policies. If you do not understand or agree to these Terms, you must not access or engage in any Covered Activities.

For purposes of these Terms, "you," "your" and/or "User" means you as the individual or entity accessing, using, or otherwise engaging in the Covered Activities. If you engage in any Covered Activities on behalf of a company or other entity then "you" includes you and that entity, and you represent and warrant that (a) you are an authorised representative of the entity with the authority to bind the entity to these Terms, and (b) you agree to these Terms on the entity's behalf.`,
  },
  {
    heading: '1. The Protocol',
    body: '',
  },
  {
    heading: '1.1 The Alphix Protocol',
    body: `The Alphix Protocol consists of a set of open-source smart contracts deployed on public, permissionless blockchains. The Protocol includes hooks implemented for Uniswap v4 and related smart contracts that introduce dynamic fee mechanisms and, where explicitly elected by Users, automated liquidity rehypothecation through smart-contract-managed vaults (the "Alphix Mechanisms").

The Alphix Protocol is designed to operate in a non-custodial and programmatic manner. All actions affecting liquidity positions, fees, and rehypothecation are executed automatically according to predefined smart contract logic and parameters. Neither the Alphix Association nor any contributor exercises discretionary control over User assets or positions.

For clarity, references to the "Protocol" include the deployed smart contracts and any disclosed off-chain infrastructure (such as analytics, monitoring, configuration tooling, or integrations) maintained by the Alphix Association or independent contributors in support of the Protocol.`,
  },
  {
    heading: '1.2 Liquidity Positions and Hook Shares',
    body: `Depending on the options selected by a User, interaction with the Alphix Protocol may result in either:

\u2022 the minting of a standard Uniswap liquidity position NFT, governed exclusively by the Uniswap v4 protocol; or
\u2022 the issuance of shares implemented by the Alphix Protocol (the "Hook Shares"), representing a proportional interest in assets managed programmatically by the Hook.

Hook Shares are issued solely as a result of a User's explicit on-chain interaction and election to participate in liquidity rehypothecation. They serve as technical accounting representations of a User's proportional interest in the vault's assets, as defined and enforced exclusively by smart contract logic.

Nature and Regulatory Character of Hook Shares. Hook Shares are technical, on-chain accounting units that track a User's proportional participation in Protocol-managed vaults. They are not investor deposits or subscriptions in any collective investment scheme, mutual fund, or analogous arrangement under Swiss law or the laws of any other jurisdiction. The issuance, transfer, or redemption of Hook Shares is structured and effected exclusively as an automated, programmatic operation by smart contracts and does not represent or confer any right of participation, entitlement to profits, or equity interest in any investment vehicle, regulated fund, or the Alphix Association.

Neither Hook Shares nor Uniswap liquidity position NFTs:

\u2022 constitute deposits, accounts, or custodial arrangements with the Alphix Association;
\u2022 represent equity, ownership, profit-sharing, or governance rights in Alphix or any affiliated entity;
\u2022 confer any claim, right, or entitlement to underlying assets, yield, rewards, dividends, distributions, or participation in any fund, pooled investment, profit-sharing arrangement, portfolio, or collective enterprise beyond the proportional vault participation defined by smart contract logic; or
\u2022 carry any guarantee as to value, yield, performance, or returns.

All positions are subject to smart contract risk, market risk, and the risks inherent to the Third-Party Protocols with which the Alphix Protocol interacts.`,
  },
  {
    heading: '1.3 Reliance on Third-Party Protocols',
    body: `The Alphix Protocol is composable by design and relies on third-party decentralized protocols, including but not limited to Uniswap, Aave, Sky, and other similar protocols (collectively, "Third-Party Protocols"), for core functionality such as liquidity provisioning, pricing, lending, borrowing, or settlement.

Alphix does not control, operate, audit, or modify the code or parameters of Third-Party Protocols and does not guarantee their security, correctness, availability, or continued operation. Users acknowledge that interactions with the Alphix Protocol necessarily expose them to risks arising from the behavior, governance decisions, upgrades, exploits, or failure of such Third-Party Protocols.`,
  },
  {
    heading: '1.4 No Custody, No Advice, No Fiduciary Relationship',
    body: `The Alphix Association does not provide custody of digital assets, personalized investment advice, or discretionary portfolio or asset management services. All actions performed by the Protocol are executed automatically by smart contracts according to predefined rules.

No fiduciary, agency, partnership, trust, or similar relationship is created, expressed, or implied by a User's interaction with the Protocol or the Services. Users retain control over whether and how they interact with the Protocol and remain solely responsible for their decisions and actions.`,
  },
  {
    heading: '1.5 Protocol Fees',
    body: `Certain components of the Alphix Protocol may apply protocol-level fees, including fees embedded in ERC-4626 vault logic or other smart contract mechanisms. Such fees are transparently defined and enforced by smart contract code and may be modified only in accordance with the Protocol's governance or upgrade mechanisms, if any.

Alphix makes no representations regarding the use, allocation, or economic impact of such fees and does not guarantee that the application of fees will result in any particular outcome or benefit for Users.`,
  },
  {
    heading: '1.6 The Alphix Association',
    body: `The Alphix Association is a Swiss association established under Articles 60 et seq. of the Swiss Civil Code, with its seat in the Canton of Zug. The Association exists to support the research, development, maintenance, and governance of the Alphix Protocol.

The Association does not act as an intermediary or counterparty to User transactions and does not assume responsibility for losses resulting from interactions with the Protocol's smart contracts or with Third-Party Protocols.`,
  },
  {
    heading: '2. The Services',
    body: '',
  },
  {
    heading: '2.1 Services',
    body: `The Services provide a user interface (the "App") designed to display blockchain data and facilitate User-initiated interactions with public, permissionless smart contracts, including the Alphix Protocol, through a non-custodial third-party wallet application (e.g., MetaMask or similar).

The App does not accept funds, route or match orders, settle transactions, or operate as an intermediary, broker, or trading venue. All transactions involving the Alphix Protocol or any Third-Party Protocols are executed directly by Users on public blockchains and occur outside the control of the App, the Services, or the Alphix Association.

Neither the Services, nor the App, nor any content displayed or made available through the Website constitutes an offer to sell, solicitation to buy, or provision of any token or financial product in any jurisdiction where such activity would be unlawful or require registration, licensing, or other authorization. The Services are not intended for persons or entities subject to such restrictions.

Documentation relevant to the Services, the App, and the Protocol is available at docs.alphix.fi (the "Documentation"). The Protocol itself and Third-Party Protocols are not part of the Services, and your use of the Protocol is entirely at your own risk and discretion.`,
  },
  {
    heading: '2.2 Nature of the Services',
    body: `The Services comprise access to software, smart contracts, and interfaces that enable Users to interact with decentralized protocols. The Services do not constitute investment services, portfolio management, custody, fiduciary, trustee, or advisory services.

No trust, pooling arrangement, fund, deposit, mandate, agency, or similar relationship is created between you and the Alphix Association, the Protocol, or any contributor by virtue of your use of the Services.`,
  },
  {
    heading: '2.3 Use of the Protocol',
    body: `Access to and use of the Protocol may be restricted, suspended, or modified at any time due to technical, legal, or security considerations, including upgrades, network conditions, or third-party dependencies.

The Alphix Association does not assume responsibility for the operation, availability, compliance, or performance of Third-Party Protocols with which the Alphix Protocol interacts.`,
  },
  {
    heading: '2.4 Governance',
    body: `The Alphix Protocol may employ on-chain or off-chain governance mechanisms, including token-based or vote-escrow\u2013based models, as described in applicable documentation.

Participation in governance does not confer any contractual, proprietary, fiduciary, or other legal rights or claims against the Alphix Association, the Protocol, the App, or any contributor, except as explicitly defined by the relevant smart contract logic.`,
  },
  {
    heading: '2.5 Pre-Launch and Experimental Features',
    body: `Certain features of the Protocol or Services may be designated as pre-launch, experimental, beta, or otherwise incomplete. Such features may be modified, paused, or discontinued at any time and may present heightened risks, including the risk of loss of digital assets.

Where applicable, additional terms or disclosures may apply to such features and shall form part of these Terms.`,
  },
  {
    heading: '2.6 Wallets',
    body: `Use of certain Services requires connection to a third-party digital wallet ("Wallet"). Wallets are provided and controlled exclusively by third parties and are not maintained, supported, or affiliated with the Alphix Association.

You acknowledge and agree that Alphix is not a party to any transactions executed through your Wallet and has no control over, and assumes no responsibility for, Wallet software, private key management, or transaction execution.

The private keys and/or seed phrases necessary to access the assets held in a Wallet are not held by or known to the Association. The Association has no ability to help you access or recover your private keys and/or seed phrases for your Wallet, so please keep them in a safe place.`,
  },
  {
    heading: '2.7 Updates; Monitoring',
    body: `The Services, the App, and the Protocol may be updated, modified, or upgraded from time to time, including through smart contract upgrades, interface changes, or parameter adjustments (the "Updates").

Your continued access to or use of the Services constitutes acceptance of any such Updates. We are not liable for any failure by you to accept and use such Updates in the manner specified or required by us.

The Association is not obliged to monitor access to or usage of the Services, but retains the right to do so as needed to maintain the integrity, security, and compliance of the Services, or as required by applicable law.`,
  },
  {
    heading: '2.8 Fees',
    body: `While the Alphix Association does not charge fees for access to the App or interface itself, your use of the Services may result in the payment of fees, including blockchain gas or network fees, protocol-level fees applied by the Alphix Protocol, and fees charged by Third-Party Protocols.

All applicable fees are determined and enforced by smart contract logic or third-party systems and are borne solely by the User. All such fees displayed within your Wallet are merely estimates and may not reflect actual costs incurred in broadcasting a transaction. Due to the nature of distributed, public blockchains, transactions are non-refundable, and the Association is not able to alter or mitigate any such fees.

You will be responsible for paying any and all taxes, duties, and assessments now or hereafter claimed or imposed by any governmental authority associated with your use of the Services, the App, the Protocol, and Third-Party Protocols.`,
  },
  {
    heading: '2.9 Regulatory Status',
    body: `The Alphix Association develops and maintains smart contract software and related interfaces that enable decentralized exchange and liquidity management functionality through public, permissionless blockchains.

The Alphix Association does not:

(a) operate a centralized or custodial exchange, order book, or trading venue;
(b) act as a broker, dealer, or intermediary;
(c) custody or control User digital assets or private keys;
(d) broker trading orders, match buyers and sellers, or settle transactions;
(e) accept funds or digital assets in a custodial or intermediary capacity;
(f) perform transmission of funds on behalf of Users; or
(g) maintain user accounts or have the ability to reverse, modify, or cancel blockchain transactions.

All transactions are executed by Users directly through smart contracts deployed on public blockchains. The App functions solely as a technical interface that enables users to construct and submit transaction data.`,
  },
  {
    heading: '2.10 No Custody; No Trust or Bailment',
    body: `At no time does the Alphix Association take custody, possession of, control over, or have the ability to unilaterally move User digital assets. All interactions occur through User-controlled wallets and smart contracts.

No trust, bailment, fiduciary, custodial, or similar relationship is created by your access to or use of the Services, and title to all digital assets remains with you at all times.`,
  },
  {
    heading: '3. Eligibility; Who May Use the Services',
    body: `You must be at least 18 years of age to access or use the Services and must not be a Prohibited Person.

A "Prohibited Person" is any individual or entity that is:

(a) listed on any sanctions or restricted parties list maintained by the United States (including the U.S. Treasury Department's list of Specially Designated Nationals or the U.S. Department of Commerce Denied Persons List or Entity List), the European Union, the United Kingdom, or Switzerland;
(b) located or organised in any U.S. embargoed countries or any country that has been designated by the U.S. Government as "terrorist supporting";
(c) a citizen, resident, or organised in any Prohibited Jurisdiction; or
(d) owned or controlled by such persons or entities listed in (a) to (c).

Prohibited Jurisdictions include: Abkhazia, Afghanistan, Belarus, Burundi, Central African Republic, Crimea, Cuba, Democratic Republic of the Congo, Donetsk and Luhansk regions of Ukraine, Iran, Libya, Mali, Myanmar (Burma), Nicaragua, North Korea, Russia, Somalia, South Ossetia, South Sudan, Sudan, Syria, Venezuela, Yemen, Zimbabwe, and any other jurisdiction subject to comprehensive sanctions or where the Services would be unlawful.

By accessing or using the Services, you represent and warrant that you are not a Prohibited Person and that you will not use VPNs, proxies, or other technical means to circumvent geographic or legal restrictions. We may update the list of Prohibited Jurisdictions at any time by posting an updated list on the Website.

The Association may (but is not obliged to) implement geofencing, sanctions-screening, wallet-screening, or other compliance controls, and may block or disable access for any user, address, jurisdiction, or transaction to comply with law or manage risk. The Association may request additional information and decline or terminate access in its sole discretion. Nothing herein creates an obligation to monitor or a duty of care.

You acknowledge and agree that you are solely responsible for complying with all applicable laws of the jurisdiction you are located in, incorporated in, or accessing the Covered Activities from.`,
  },
  {
    heading: '4. Privacy Policy',
    body: `Our Privacy Policy describes how the Association handles personal data in connection with the Services and is hereby incorporated into these Terms by reference. For a detailed explanation of our privacy practices, including your rights with respect to any personal data, please refer to the Privacy Policy located at https://alphix.fi/privacy.

By accessing or using any Covered Activities, you consent to our Privacy Policy and to the collection and processing of information as outlined therein. You further consent to receiving electronic communications and to the use of electronic signatures; we may collect and retain acceptance logs, including, but not limited to, timestamps, IP addresses, device metadata, and wallet addresses or signed wallet messages, as evidence of your acceptance of these Terms.`,
  },
  {
    heading: '5. Rights We Grant You',
    body: '',
  },
  {
    heading: '5.1 Right to Use Services',
    body: `Subject to these Terms, we grant you a limited, revocable, personal, non-commercial, non-exclusive, non-transferable, non-assignable, and non-sublicensable license to access, use, and display the Services and any software, content, or other materials we make available as part of the Services, solely to enable your permitted use under these Terms.

All rights not expressly granted are reserved. This license does not transfer ownership or any intellectual property rights, and no rights arise by implication, estoppel, or otherwise.

We may suspend, restrict, or interrupt access (including for maintenance, updates, repairs, or malfunctions) and may revoke this license for cause, including for breach or misuse.`,
  },
  {
    heading: '5.2 Restrictions on Your Use of the Services',
    body: `You may not do any of the following in connection with your use of the Services, unless applicable law prohibits these restrictions or we have given you our written permission:

(a) download, modify, copy, distribute, transmit, display, perform, reproduce, duplicate, publish, license, create derivative works from, or offer for sale any information contained on, or obtained from or through, the Services, except for temporary files automatically cached by your web browser for display purposes;
(b) duplicate, decompile, reverse engineer, disassemble, or decode the Services (including any underlying idea or algorithm), or attempt to do any of the same, except to the extent permitted by applicable law;
(c) use, reproduce, or remove any copyright, trademark, service mark, trade name, slogan, logo, image, or other proprietary notation displayed on or through the Services;
(d) use automation software (bots), hacks, modifications (mods), or any other unauthorized third-party software designed to modify the Services;
(e) use or exploit the Services for any commercial or internal business purpose without our prior written consent;
(f) access or use the Services in any manner that could disable, overburden, damage, disrupt, or impair the Services or interfere with any other party's access to or use of the Services;
(g) attempt to gain unauthorized access to, interfere with, damage, or disrupt the Services or the computer systems, wallets, accounts, protocols, or networks connected to the Services;
(h) circumvent, remove, alter, deactivate, degrade, or thwart any technological measure or content protections of the Services;
(i) use any robot, spider, crawler, or other automatic device, process, software, or query that intercepts, "mines," scrapes, or otherwise accesses the Services to monitor, extract, copy, or collect information or data from or through the Services;
(j) introduce any viruses, trojan horses, worms, logic bombs, or other materials that are malicious or technologically harmful into our systems;
(k) submit, transmit, display, perform, post, or store any content that is unlawful, defamatory, obscene, harmful, hateful, deceptive, threatening, abusive, or otherwise objectionable;
(l) violate any applicable law or regulation in connection with your access to or use of the Services; or
(m) access, use, or interact with the Services in any way not expressly permitted by these Terms.`,
  },
  {
    heading: '6. Ownership and Intellectual Property',
    body: '',
  },
  {
    heading: '6.1 Ownership of the Services',
    body: `The Services, including their "look and feel" (e.g., text, graphics, images, logos), proprietary content, information, and other materials, are protected under copyright, trademark, and other intellectual property laws. You agree that the Association or its licensors own all right, title, and interest in and to the Services (including any and all intellectual property rights therein) and you agree not to take any action(s) inconsistent with such ownership interests. We and our licensors reserve all rights in connection with the Services and its content, including, without limitation, the exclusive right to create derivative works.`,
  },
  {
    heading: '6.2 Ownership of Trademarks',
    body: `The Association's and/or the Protocol's name, trademarks, and logos and all related names, logos, product and service names, designs, and slogans are trademarks of the Association or its affiliates or licensors. You may not use our names, trademarks, or logos without prior written consent.`,
  },
  {
    heading: '6.3 Ownership of Feedback',
    body: `We welcome feedback, bug reports, comments, and suggestions for improvements to the Services ("Feedback"). You acknowledge and expressly agree that any contribution of Feedback does not and will not give or grant you any right, title, or interest in the Services, the Protocol, and/or any Covered Activities or in any such Feedback. All Feedback becomes the sole and exclusive property of the Association, and the Association may use and disclose Feedback in any manner and for any purpose whatsoever without further notice or compensation to you and without retention by you of any proprietary or other right or claim. You hereby assign to the Association any and all right, title, and interest (including, but not limited to, any patent, copyright, trade secret, trademark, moral rights, and any and all other intellectual property right) that you may have in and to any and all Feedback.`,
  },
  {
    heading: '7. Third-Party Services and Protocols',
    body: `The Services may display or facilitate interaction with Third-Party Protocols and related data. The Association does not endorse, control, or assume responsibility for any Third-Party Protocols or materials.

Your use of Third-Party Protocols is governed exclusively by their own terms and conditions, and the Association shall not be liable for losses arising from such interactions.

The Association is not responsible for examining or evaluating the content, accuracy, completeness, availability, timeliness, validity, copyright compliance, legality, decency, quality, risk, functionality, safety, or any other aspect of such Third-Party Protocols. You irrevocably waive any claim against the Association with respect to such Third-Party Protocols. Third-Party Protocols and links to other websites are provided solely as a convenience to you.`,
  },
  {
    heading: '8. Disclaimers, Limitations of Liability, and Indemnification',
    body: '',
  },
  {
    heading: '8.1 Disclaimers',
    body: `Your access to and use of the Covered Activities are entirely at your own risk. The Covered Activities are provided on an "AS IS" and "AS AVAILABLE" basis.

To the maximum extent permitted by applicable law, the Alphix Association, its contributors, affiliates, officers, directors, employees, agents, representatives, and licensors (collectively, the "Alphix Parties"), together with any independent operators, multisignature signatories, or governance participants (collectively, "Related Parties"), disclaim all warranties, representations, and conditions, whether express, implied, or statutory, including, without limitation, any implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, availability, accuracy, reliability, quality, performance, suitability, or absence of defects.

Without limiting the foregoing, the Alphix Parties and Related Parties make no warranty or representation and disclaim all responsibility and liability for:

(a) the accuracy, completeness, timeliness, availability, security, or reliability of the Services, the App, the Protocol, or any Covered Activities;
(b) any loss, damage, or harm resulting from your access to or use of the Services, including loss of digital assets, private keys, data, or opportunity;
(c) the compatibility or interoperability of the Services with any wallet, blockchain, smart contract, protocol, or third-party system; or
(d) whether the Services or any Covered Activities will meet your requirements or operate uninterrupted, securely, or error-free.

The Alphix Parties are not registered with, licensed by, or supervised by any financial services, securities, banking, or virtual asset regulator, except where expressly required under applicable law.

No advice or information, whether oral or written, obtained from the Alphix Parties or through the Services and/or any Covered Activities, shall create any warranty or representation not expressly made herein. All transfers and other actions you perform using data provided by the App or any Covered Activities are unsolicited; you confirm that you have not received any investment advice or solicitation from any Alphix Parties or Related Parties in relation to such actions, and that the Association does not conduct any suitability review of them.

All information provided by the App and/or any Covered Activities is for informational purposes only and should not be construed as investment, legal, tax, accounting, or other professional advice. You alone are responsible for determining whether any transaction, strategy, or use of the Protocol is appropriate for you in light of your objectives, financial circumstances, and risk tolerance.

For the avoidance of doubt, none of the Alphix Parties or Related Parties owes you any fiduciary duties. The Alphix Parties and Related Parties do not, and shall not be construed to, provide investment management, portfolio management, investment advisory, custody, dealing, arranging, or any other financial or virtual asset services to or for any user, whether express or implied.`,
  },
  {
    heading: '8.2 Acknowledgements',
    body: `You expressly acknowledge and agree that none of the Alphix Parties or Related Parties makes any representation, warranty, or assurance, express or implied, regarding:

(i) the legal, regulatory, or tax treatment of the Protocol, any token, liquidity position, Hook Share, ERC-4626 wrapper, or Covered Activity;
(ii) the liquidity, value, marketability, or transferability of any digital asset or position;
(iii) whether any digital asset will retain or acquire value;
(iv) the performance, profitability, or suitability of any strategy, fee mechanism, or configuration;
(v) whether any token or position constitutes a security or regulated instrument in any jurisdiction; or
(vi) the future development, success, or viability of the Protocol.

Your participation is based solely on your own judgment, research, and risk assessment.`,
  },
  {
    heading: '8.3 Limitations of Liability',
    body: `TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE ALPHIX PARTIES AND RELATED PARTIES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS INTERRUPTION, ARISING OUT OF OR RELATING TO THE SERVICES OR COVERED ACTIVITIES, UNDER ANY THEORY OF LIABILITY (CONTRACT, TORT\u2014INCLUDING NEGLIGENCE\u2014STRICT LIABILITY, OR OTHERWISE), EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE AGGREGATE LIABILITY OF THE ALPHIX PARTIES AND RELATED PARTIES SHALL NOT EXCEED CHF 100.

NOTHING IN THESE TERMS EXCLUDES OR LIMITS LIABILITY FOR FRAUD, WILFUL MISCONDUCT, OR ANY LIABILITY THAT CANNOT LAWFULLY BE EXCLUDED OR LIMITED (INCLUDING, WHERE APPLICABLE, DEATH OR PERSONAL INJURY CAUSED BY NEGLIGENCE). SOME JURISDICTIONS DO NOT ALLOW CERTAIN EXCLUSIONS OR LIMITATIONS; IN THOSE CASES, THE EXCLUSIONS AND LIMITATIONS ABOVE APPLY ONLY TO THE MAXIMUM EXTENT PERMITTED BY LAW.`,
  },
  {
    heading: '8.4 Assumption of Risks',
    body: `(a) By using or interacting with any Covered Activities, you represent that you have sufficient knowledge and experience in business and financial matters, including a sufficient understanding of blockchain technologies, cryptocurrencies and other digital assets, storage mechanisms (such as Wallets), and blockchain-based software systems to be able to assess and evaluate the risks and benefits of the Covered Activities contemplated hereunder, and will bear the risks thereof, including loss of all amounts paid, and the risk that the cryptocurrencies and other digital assets may have little or no value. You acknowledge and agree that there are risks associated with purchasing and holding cryptocurrency, using blockchain technology, and interacting with smart contracts. These include, but are not limited to:

\u2022 risk of losing access to cryptocurrency due to loss of private key(s), custodial error, or user error;
\u2022 risk of mining or blockchain attacks;
\u2022 risk of hacking and security weaknesses;
\u2022 risk of unfavorable regulatory intervention in one or more jurisdictions;
\u2022 risk related to token taxation;
\u2022 risk of personal information disclosure;
\u2022 risk of uninsured losses;
\u2022 volatility risks; and
\u2022 unanticipated risks.

Digital assets are neither (i) deposits of or guaranteed by a bank nor (ii) insured by the FDIC, FINMA depositor protection, or any other governmental agency.

(b) There may be certain multisignature crypto wallets (the "Multisigs," and the signatories to such Multisigs, the "Multisig Members") that could have certain controls related to the Protocol, which may include, but are not limited to, the ability to pause certain functionality of the Protocol, implement or influence upgrades to the Protocol (or any aspect thereof), and certain other controls of the functionality of the Protocol as described in the Documentation or in public communications. The Alphix Parties cannot control the actions of such Multisig Members and thus certain Multisigs will be outside of our control. The Alphix Parties therefore cannot be held liable for any action, or inaction, relating to such a Multisig.

(c) The regulatory regimes governing blockchain technologies, cryptocurrencies, and other digital assets are uncertain, and new regulations or policies may materially adversely affect the potential utility or value of the Covered Activities, the Protocol, Third-Party Protocols, cryptocurrencies and other digital assets, or the ability of the Association or any other relevant party to continue to provide or support such Covered Activities and/or the App. You are encouraged to consult with your own tax advisor with respect to potential tax implications associated with utilizing the Covered Activities, the App, and the Protocol.

(d) We cannot control or influence market sentiment or liquidity or how third-party services or platforms support, quote, restrict or provide access to, or value cryptocurrencies and other digital assets, and we expressly deny and disclaim any liability to you and deny any obligations to indemnify or hold you harmless for any losses you may incur as a result of fluctuations in the value of cryptocurrencies or other digital assets.

(e) Smart contracts execute automatically when certain conditions are met. Transactions on blockchains or using smart contracts often cannot be stopped or reversed, so vulnerabilities in the programming, design, or implementation of a blockchain, the Protocol, any deployed smart contracts, or a Third-Party Protocol may arise due to hacking or other security incidents and could result in significant adverse effects, including but not limited to, significant volatility or loss of any digital assets you elect to interact with.

(f) The Documentation describes certain risks associated with the Protocol in detail. Please review the Documentation for additional risks associated with utilizing the Services or the App in conjunction with your use of, and access to, the Protocol. The Alphix Parties hereby disclaim any and all liability associated with risks disclosed in the Documentation to the fullest extent provided by applicable law.

(g) During pre-launch and transitional phases, certain administrative keys and/or multisignature wallets may control aspects of the Protocol (including pausing, upgrades, and parameter changes). Such controls may be exercised by persons independent of the Association, and the Association does not control the actions of those persons. Accordingly, the Protocol should not be regarded as "decentralised" unless and until material control and parameter-setting authority have been transferred to a community governance framework as described in the Documentation.`,
  },
  {
    heading: '8.5 Indemnification',
    body: `By entering into these Terms and accessing or using the Services, you agree that you shall defend, indemnify, and hold the Alphix Parties and Related Parties harmless from and against any and all claims, costs, damages, losses, liabilities, and expenses (including attorneys' fees and costs) arising out of or in connection with:

(a) your violation or breach of any term of these Terms or any applicable law or regulation;
(b) your violation of any rights of any third party;
(c) your misuse of the Covered Activities; or
(d) your negligence or wilful misconduct.

If you are obligated to indemnify any such party hereunder, then you agree that the Association (or, at its discretion, the applicable indemnitee) will have the right, in its sole discretion, to control any action or proceeding and to determine whether to settle, and if so, on what terms, and you agree to fully cooperate in the defence or settlement of such claim.`,
  },
  {
    heading: '9. Third-Party Beneficiaries',
    body: `You and the Association acknowledge and agree that the Related Parties (as defined in Section 8.1) are third-party beneficiaries of these Terms, including without limitation under Sections 8 and 9, and may enforce such provisions directly against you.`,
  },
  {
    heading: '10. Arbitration and Class Action Waiver',
    body: `PLEASE READ THIS SECTION CAREFULLY \u2013 IT MAY SIGNIFICANTLY AFFECT YOUR LEGAL RIGHTS, INCLUDING YOUR RIGHT TO FILE A LAWSUIT IN COURT AND TO HAVE A JURY HEAR YOUR CLAIMS. IT CONTAINS PROCEDURES FOR MANDATORY BINDING ARBITRATION AND A CLASS ACTION WAIVER.`,
  },
  {
    heading: '10.1 Informal Process First',
    body: `You and the Association agree that in the event of any dispute between you and the Alphix Parties or Related Parties, either party will first contact the other party and make a good faith sustained effort to resolve the dispute before resorting to more formal means of resolution, including without limitation, any court action or arbitration, after first allowing the receiving party 30 days in which to respond. Both you and the Association agree that this dispute resolution procedure is a condition precedent which must be satisfied before initiating any arbitration against you or any Alphix Party or Related Party, as applicable.`,
  },
  {
    heading: '10.2 Governing Law',
    body: `These Terms and any non-contractual obligations arising out of or in connection with them are governed by the substantive laws of Switzerland, without regard to conflict-of-laws principles.`,
  },
  {
    heading: '10.3 Arbitration Agreement and Class Action Waiver',
    body: `Following the informal dispute resolution process, any dispute, controversy, or claim (a "Claim") arising out of or in connection with the Covered Activities (including the App, any access to or inability to access the App, and any interaction with the Protocol, whether direct or indirect) shall be referred to and finally resolved by arbitration, including any question concerning the existence, formation, validity, or enforceability of this arbitration agreement.

The arbitration shall be conducted under the Swiss Rules of International Arbitration of the Swiss Arbitration Centre (the "Rules"), which are incorporated by reference, by a sole arbitrator appointed in accordance with the Rules (or, for claims exceeding CHF 1,000,000, by a tribunal of three arbitrators). The seat (legal place) of arbitration shall be Zug, Switzerland, and the language of the arbitration shall be English.

Each arbitration must be conducted on an individual basis only; class, collective, or representative proceedings are not permitted, and you waive any right to participate in such proceedings.

The existence of, content of, and materials disclosed in any arbitration, together with any award, shall be confidential except to the extent disclosure is required for enforcement or by applicable law or a competent regulatory authority.

The arbitral tribunal shall have discretion to make such orders as to costs (including legal and arbitration fees) as it considers appropriate, with a presumption that costs shall follow the event (the unsuccessful party bearing the reasonable legal and arbitration costs of the successful party), unless the tribunal determines otherwise. The tribunal may also require any party to provide security for costs in accordance with the Rules.

Bellwether Procedure. Where fifty (50) or more substantially similar Claims are filed by or with the same counsel or organisation, only ten (10) bellwether arbitrations shall proceed initially. The remainder shall be stayed, and any filing or administrative fees for the stayed cases held in abeyance. Following the resolution of the bellwethers, the parties shall confer in good faith on the treatment of the remaining Claims.

Limitation Period. To the fullest extent permitted by applicable law, any Claim must be commenced within twelve (12) months after the cause of action accrued, after which it shall be permanently barred.

Damages Limitation. The arbitral tribunal shall not award punitive, exemplary, multiple, or indirect damages and shall limit any relief granted to actual, direct losses, subject to the limitations set forth in Section 8.3.

The tribunal may grant any relief or remedy available at law or in equity, subject to these Terms. Any award rendered shall be final and binding, and judgment upon the award may be entered in any court of competent jurisdiction.

Interim Relief. Either party may seek interim, conservatory, or injunctive relief from any court of competent jurisdiction pending the constitution of the tribunal or to preserve the status quo.

Notices. Notices and communications in the arbitration may validly be given by email to the most recent email address provided by a party and/or by signed on-chain message to the wallet address associated with the Services.

Challenge and Enforcement. Any application to set aside or challenge an award shall be brought exclusively before the competent courts of Switzerland. Proceedings to recognise or enforce an award may be brought in any court of competent jurisdiction.

This arbitration agreement, including any question as to its existence, validity, interpretation, or enforceability, shall be governed by the laws of Switzerland.`,
  },
  {
    heading: '10.4 Exceptions to Arbitration',
    body: `Notwithstanding Section 10.3, either party may:

(a) bring an individual action in the courts of the Canton of Zug, Switzerland, for claims within the jurisdiction of such courts, provided that such claims do not exceed CHF 30,000;
(b) seek interim or injunctive relief from any court of competent jurisdiction to prevent imminent harm or preserve the status quo; or
(c) bring claims that cannot, as a matter of mandatory applicable law, be subjected to arbitration.`,
  },
  {
    heading: '11. Miscellaneous',
    body: '',
  },
  {
    heading: '11.1 Severability',
    body: `If any provision of these Terms is found to be invalid or unenforceable, that provision will be enforced to the maximum extent permissible and the remaining provisions will remain in full force and effect.`,
  },
  {
    heading: '11.2 No Waiver',
    body: `Failure or delay by us in exercising any right or remedy under these Terms will not operate as a waiver of that or any other right or remedy.`,
  },
  {
    heading: '11.3 Assignment',
    body: `You may not assign or transfer these Terms without our prior written consent. We may assign these Terms to an affiliate or in connection with a merger, reorganisation, or sale of assets.`,
  },
  {
    heading: '11.4 Headings',
    body: `Headings are for convenience only and do not affect interpretation.`,
  },
  {
    heading: '11.5 Electronic Records',
    body: `The Association's electronic records, including acceptance logs and wallet signatures, shall be conclusive evidence of your agreement to these Terms, absent manifest error.`,
  },
  {
    heading: '11.6 Updates to Terms',
    body: `We may update these Terms by posting an updated version with a revised "Last updated" date; where required by law we will provide additional notice, and your continued use after the effective date constitutes acceptance.`,
  },
  {
    heading: '11.7 Entire Agreement',
    body: `These Terms, together with the Privacy Policy and any other documents expressly incorporated by reference, constitute the entire agreement between you and the Association with respect to the subject matter hereof and supersede all prior or contemporaneous communications and proposals, whether oral or written.`,
  },
  {
    heading: '11.8 Contact',
    body: `For questions regarding these Terms, please contact: legal@alphix.fi`,
  },
]

/**
 * The exact message to be signed by the user's wallet when accepting the ToS.
 */
export const TOS_SIGNATURE_MESSAGE = `I accept the Terms of Service, listed at https://alphix.fi/terms, and the Privacy Policy, listed at https://alphix.fi/privacy. I acknowledge that I am not a citizen or resident of a Prohibited Jurisdiction, as defined in the Terms of Service.`
