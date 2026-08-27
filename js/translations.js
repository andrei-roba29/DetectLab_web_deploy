        // ── TRANSLATIONS ──
        const translations = {
            en: {
                nav_apm: 'What is APM', nav_map: 'Explore Map', nav_how: 'How it Works', nav_pricing: 'Pricing', nav_useful: 'Useful Information', nav_cta: 'Get Access',
                hero_badge: 'Archaeology × Artificial Intelligence', hero_tagline: 'Saving History Together',
                hero_desc: 'An Archaeological Prediction Model that automatically identifies high-potential zones for ancient settlements — using topographic, geological, and hydrographic data collected since the dawn of civilization.',
                hero_btn1: '🗺 Explore the Map', hero_btn2: 'View Membership Plans', scroll: 'Scroll to discover',
                what_label: 'Technology', what_title: 'What is an <span class="hl">Archaeological Prediction Model</span>?',
                what_desc: 'Think of it as a smart map that reads the landscape like an archaeologist. Instead of spending years walking fields and digging randomly, the APM analyzes thousands of environmental variables to tell you: <em>here is where people lived.</em>',
                card1_title: '🏔 Topographic Analysis', card1_desc: 'Elevation, slope and terrain relief — ancient settlements preferred defensible high ground and gentle southern slopes close to resources.',
                card2_title: '💧 Hydrographic Proximity', card2_desc: 'Distance to rivers, springs and wetlands — every civilization in history settled within reach of fresh water. The model maps those ancient corridors.',
                card3_title: '🪨 Geological Conditions', card3_desc: 'Soil fertility, substrate stability and mineral availability — factors that drove human migration and permanent settlement for 10,000 years.',
                leg5: 'Score 5.0 — Very High Potential', leg4: 'Score 4.0 — High Potential', leg3: 'Score 3.1 — Moderate Potential', leg2: 'Score 2.1 — Low Potential', leg1: 'Score 1.2 — Minimal Potential',
                apm20_leg5: 'Score 5 — Very High Potential', apm20_leg4: 'Score 4.5 — High Potential', apm20_leg3: 'Score 4 — Moderate Potential', apm20_leg2: 'Score 3 — Low Potential', apm20_leg2b: 'Score 2 — Minimal Potential', apm20_leg1: 'Score 1 — No Potential',
                map_label: 'Live Map', map_title: 'Explore the <span class="hl">APM Layer</span>',
                tab_free: '🔓 Free Preview', tab_member: '🔐 Members Map',
                manage_account: 'Manage Account',
                nav_events: 'Events', nav_logout: 'Log Out',
                lock_title: 'Members-Only Map', lock_desc: 'Subscribe to unlock full-resolution APM layers, advanced filters, and export tools.', lock_btn: 'View Plans',
                apm_score: 'APM Score:',
                how_label: 'Process', how_title: 'How <span class="hl">DetectLab</span> Works',
                step1_title: 'Data Collection', step1_desc: 'We aggregate topographic, hydrographic and geological datasets from national and international sources.',
                step2_title: 'QGIS Modeling', step2_desc: 'Layers are processed and weighted inside QGIS using spatial algorithms.',
                step3_title: 'Scoring & Classification', step3_desc: 'Every zone receives an APM score from 1 to 5.0 representing its probability of containing buried archaeological remains.',
                step4_title: 'Interactive Map', step4_desc: 'Results are published as an interactive web map overlaid on satellite imagery — ready for researchers, institutions and enthusiasts.',
                pricing_label: 'Membership', pricing_title: 'Choose Your <span class="hl">Plan</span>', pricing_desc: "Whether you're a hobbyist, a researcher, or an institution — DetectLab has a plan for you.",
                lbl_weekly: 'Weekly', lbl_monthly: 'Monthly', save_badge: 'Save up to 45%',
                tier_bronze: 'Bronze', tier_silver: 'Silver', tier_gold: 'Gold',
                plan_weekly: 'Weekly', plan_monthly: 'One month', plan_yearly: 'Yearly',
                note_weekly: 'Not available', note_monthly: 'One-time payment', note_yearly: 'Not available',
                badge_popular: 'Most Popular',
                not_available: 'Not available',
                f_map: 'Full APM interactive map', f_sat: 'Satellite + APM overlay', f_legend: 'Score legend & zone info',
                f_export: 'Export data (GeoJSON, KMZ)', f_filters: 'Advanced layer filters', f_api: 'API access', f_api_plus: 'API access + priority support',
                btn_bronze: 'Buy', btn_silver: 'Buy', btn_gold: 'Buy',
                free_title: 'Free — Always Available', free_desc: 'Explore a limited preview of the APM map, read about the methodology and learn what archaeological prediction can do for research.', free_btn: 'Explore Free Map',
                // ── Premium membership ──
                prem_modal_title: 'DetectLab Premium',
                prem_modal_sub: 'Unlock every premium layer on the interactive map.',
                prem_login_needed: 'You need a free account to buy Premium. Log in or register — it takes a minute.',
                prem_login_btn: 'Log in / Register',
                prem_already: 'Your Premium month is still active. Thank you for supporting DetectLab!',
                prem_feat_apm20: 'APM 2.0 — advanced archaeological prediction model',
                prem_feat_hist: 'Historical maps — Josephine +, Bucovina 1861–1864, Austro-Hungarian, WWI, WWII',
                prem_feat_lidar: 'LIDAR Scanner — point-cloud analysis around any location',
                prem_feat_archeo: 'Archeological Potential — automatic candidate zone analysis',
                prem_feat_roman: 'Roman Empire layers — roads, forts and settlements',
                prem_price_line: '€5 <small class="vat-note">+TVA</small> for one month — no automatic renewal',
                prem_buy_btn: 'Buy Premium · €5 <small class="vat-note">+TVA</small> for one month',
                prem_later: 'Not now',
                prem_manage: 'Manage subscription',
                prem_panel_locked: 'Premium layers are locked',
                prem_panel_desc: 'Become a Premium member to unlock every layer and tool.',
                prem_panel_cta: 'Become a premium member',
                prem_layer_locked_label: 'Premium layer locked',
                babel_title: 'Locality historical dossier',
                // ── Checkout page ──
                co_back_map: 'Back to map',
                co_login_title: 'Log in to continue',
                co_login_desc: 'You need an account to purchase Premium.',
                co_login_btn: 'Go to login',
                co_order_title: 'Order summary',
                co_plan_name: 'DetectLab Premium — one month',
                co_all_layers: 'All premium map layers',
                co_total: 'Total due today',
                co_period_once: 'one-time',
                co_renews: '€5 <small class="vat-note">+TVA</small> for one month — no automatic renewal',
                co_no_renewal: 'No automatic renewal — you will not be charged again.',
                co_pay_title: 'Payment method',
                co_pay_by: 'Pay securely with',
                co_pay_btn: 'Pay €5.00 <small class="vat-note">+TVA</small>',
                co_stripe_note: 'Cards, Apple Pay and Google Pay are accepted on Stripe\'s secure payment page.',
                co_redirecting: 'Taking you to Stripe\'s secure payment page…',
                co_processing: 'Confirming your payment…',
                co_processing_desc: 'This usually takes a few seconds.',
                co_cancelled: 'Payment cancelled — you were not charged.',
                co_portal_return: 'Billing settings updated.',
                co_pending_title: 'Payment received — activating Premium…',
                co_pending_desc: 'This usually takes a few seconds. If it doesn\'t activate, check again or go to your account.',
                co_check_again: 'Check again',
                co_already_title: 'You are already Premium',
                co_already_desc: 'Your Premium month is still active. You can buy another month once it ends.',
                co_manage_billing: 'Manage subscription',
                co_not_configured: 'Payments are not configured yet. Please try again later.',
                co_login_needed: 'Please log in first.',
                co_secure: 'Payments are encrypted and processed securely.',
                co_success_title: 'Payment confirmed!',
                co_success_desc: 'Your account is Premium for one month. Enjoy every premium layer.',
                co_success_expiry: 'Premium active until',
                co_go_account: 'Go to my account',
                co_footer: 'DetectLab · Saving history together',
                // ── Promo codes (free trial) ──
                promo_or: 'or',
                promo_have_code: 'Have a promo code?',
                promo_label: 'Promo code',
                promo_redeem_btn: 'Redeem',
                promo_hint: 'Unlock Premium instantly — no payment needed.',
                promo_success: 'Code redeemed! Premium is active until {date}.',
                promo_success_title: 'Promo code redeemed!',
                promo_success_desc: 'Premium is unlocked on your account — no payment was taken.',
                promo_go_map: 'Start exploring the map',
                promo_err_invalid: 'This promo code is not valid. Check the spelling and try again.',
                promo_err_expired: 'This promo code has expired.',
                promo_err_not_started: 'This promo code is not active yet.',
                promo_err_exhausted: 'This promo code has reached its limit.',
                promo_err_already_redeemed: 'You have already used this promo code.',
                promo_err_trial_used: 'Your account has already used its free trial.',
                promo_err_already_premium: 'Your Premium is still active — no need for a code yet.',
                promo_err_too_many: 'Too many attempts. Please try again in a few minutes.',
                promo_err_login: 'Please log in to redeem a promo code.',
                promo_err_generic: 'Could not redeem the code. Please try again.',
                // ── Account / subscription ──
                acct_subscription: 'Premium',
                acct_buy_premium: 'Buy Premium · €5 <small class="vat-note">+TVA</small> for one month',
                acct_renew: 'Buy another month',
                acct_manage: 'Manage subscription',
                acct_expires_on: 'Expires on',
                acct_premium_until: 'Premium until {date}',
                acct_days_left: '{n} days left',
                acct_day_left: '{n} day left',
                acct_no_sub: 'No active Premium',
                acct_no_renewal: '€5 <small class="vat-note">+TVA</small> for one month — no automatic renewal',
                f_product: 'Product', f_resources: 'Resources', f_contact: 'Contact',
                f_method: 'Methodology', f_docs: 'Documentation', f_papers: 'Research Papers', f_qgis: 'QGIS Project',
                f_about: 'About Us', f_partner: 'contact@detectlab.ro', f_press: 'Press',
                get_app_label: 'Mobile App',
                get_app_title: 'Get the <span class="hl">DetectLab</span> App',
                get_app_desc: 'Install the application on your mobile device for quick access to the prediction model.',
                btn_android: 'Android App',
                btn_ios: 'iOS App',
                footer_desc: 'Saving history together!',
                f_rights: 'All rights reserved.', f_built: 'Built with QGIS · OpenLayers · passion for the past',
                layer_opacity: 'Layer Opacity',
                layer_satellite: 'Satellite',
                layer_osm_places: 'OSM Places',
                layer_uat: 'UAT',
                layer_heritage: 'Heritage',
                heritage_legend_title: 'Legend',
                heritage_legend_red: 'Sites with correct coordinates',
                heritage_legend_green: 'Sites with approximate coordinates',
                heritage_legend_yellow: 'Tumulus',
                layer_opacity_label: 'Opacity',
                layer_roman: 'Roman Empire',
                layer_roads: 'Roads',
                layer_vici_sites: 'Roman Sites (DARE)',
                layer_dare_11: 'Major Settlements',
                layer_dare_17: 'Major Forts',
                layer_dare_13: 'Civitas Capitals',
                layer_dare_12: 'Regular Settlements',
                layer_dare_18: 'Forts/Castrum',
                layer_dare_53: 'Fortlets/Towers',
                layer_dare_16: 'Roads/Coastal Stations',
                layer_dare_61: 'Sanctuaries/Temples',
                layer_dare_66: 'Baths',
                layer_dare_32: 'Tumuli',
                layer_dare_63: 'Cemeteries',
                layer_dare_21: 'Monasteries',
                layer_dare_24: 'Churches',
                layer_dare_14: 'Villas',
                layer_dare_57: 'Mines/Quarries',
                layer_dare_49: 'Passes',
                layer_dare_51: 'Bridges',
                layer_dare_55: 'Roads/Milestones',
                layer_dare_52: 'Aqueducts',
                layer_dare_64: 'Monuments',
                layer_urban_areas: 'Urban Areas',
                layer_aqueducts: 'Aqueducts',
                layer_walls: 'Walls',
                layer_regional_names: 'Regional Names',
                layer_political_shading: 'Political Shading',
                layer_re_117: 'RE 117 CE',
                layer_re_60bce: 'RE 60 BCE',
                layer_re_200: 'RE 200 CE',
                layer_alexander: "Alexander's Empire",
                layer_persian: 'Persian Empire',
                layer_diocletian: 'Prov. after Diocletian',
                layer_historical: 'Historical Maps',
                layer_historical_premium: 'Historical maps',
                layer_josephine: 'Josephine Map +',
                layer_iosfree: 'Josephine Map',
                layer_austrian: 'Austrian Map 1910',
                layer_firingplans: 'Firing Plans',
                layer_sovietmap: "Soviet Map 1970's",
                layer_bucovina: 'Bucovina 1861-1864',
                layer_austrohu: 'Austro-Hungarian Map (1861-1864)',
                layer_moldova1868: 'Moldova 1868',
                layer_moldovawwii: 'Moldova WWII',
                layer_polishtactical1933: 'Tactical Polish Map 1933',
                layer_ww1: 'WWI',
                layer_ww2: 'WWII',
                layer_satellite60s: "Satellite imagery 60's",
                layer_banat: 'Banat - 1769-1772',
                layer_archeo_potential: 'Archeological Potential Sites',
                archeo_desc: 'Statistical analysis · 10 km radius',
                archeo_run_btn: 'Candidate Areas',
                archeo_run_running: 'Analyzing…',
                archeo_status_ready: 'Press the button to analyze the current 10 km radius.',
                archeo_legend_medium: 'Medium Potential',
                archeo_legend_high: 'High Potential',
                archeo_hint: 'Candidates = gaps between known sites, inside the UAT red zone, ≥ 700 m from every site.',
                archeo_show_label: 'Show results',
                // ── Premium: Archeological Report / Raport arheologic (js/archeo-report.js) ──
                layer_arch_report: 'Archeological Report',
                arch_report_desc: '5 km² · APM 2.0 + potential zones + LIDAR · PDF',
                arch_report_hint: 'Switch the layer on and pick a point on the map.',
                arch_report_hint_bottom: 'Excluded: inside or within 500 m of a UAT, inside the radii of known sites, or APM 2.0 below average (khaki → red) — unless annotated on LIDAR.',
                arch_report_run_btn: 'Generate report',
                arch_report_run_running: 'Analyzing…',
                arch_report_pdf_btn: 'Download PDF',
                arch_report_show_results: 'Show results on the map',
                arch_report_need_point: 'Pick a point on the map first.',
                arch_report_point_set: 'Analysis point: {lat}, {lng} — press “Generate report”.',
                arch_report_point_title: 'Report point',
                arch_report_step_sites: 'Loading the known archaeological sites…',
                arch_report_step_potential: 'Triangulating the potential zones…',
                arch_report_step_lidar: 'Reading the LIDAR Scanner annotations…',
                arch_report_step_uat: 'Reading the UAT layer (red zone + 500 m)…',
                arch_report_step_apm: 'Reading the APM 2.0 colours…',
                arch_report_step_scoring: 'Scoring the candidates…',
                arch_report_done: 'Analysis complete — the results are on the map.',
                arch_report_no_results: 'No result passed the filters in this area. Try another point.',
                arch_report_error: 'The analysis failed — see the console for details.',
                arch_report_need_results: 'Run the analysis first.',
                arch_report_summary_detail: '{seeds} points tested · {passed} passed the filters · {bubbles} potential zones · {lidar} LIDAR objects in the area',
                arch_report_pdf_capturing: 'Preparing the screenshots…',
                arch_report_pdf_building: 'Building the PDF…',
                arch_report_pdf_done: 'PDF ready: {name} ({pages} pages).',
                arch_report_result: 'Result',
                arch_report_score: 'Score',
                arch_report_class_high: 'High potential',
                arch_report_class_medium: 'Medium potential',
                arch_report_class_low: 'Low potential',
                arch_report_row_apm: 'APM 2.0',
                arch_report_row_potential: 'Potential zone',
                arch_report_row_lidar: 'LIDAR',
                arch_report_row_uat: 'UAT',
                arch_report_row_period: 'Estimated period',
                arch_report_pot_inside: 'inside a zone scored {score}',
                arch_report_pot_near: '{dist} from a zone scored {score}',
                arch_report_pot_none: 'no triangulation zone nearby',
                arch_report_lidar_hit: 'annotated on LIDAR — {title}',
                arch_report_lidar_near: 'LIDAR object at {dist}',
                arch_report_lidar_none: 'no LIDAR object nearby',
                arch_report_uat_ok: 'red zone · ≥ {dist} from the UAT',
                arch_report_closest_site: 'Closest site',
                arch_report_popup_hint: 'Download the PDF for the full explanation.',
                arch_report_site_unknown: 'Unnamed site',
                arch_report_flag_lidar: 'annotated on LIDAR Scanner',
                arch_report_title: 'Archaeological Report',
                arch_report_subtitle: 'DetectLab analysis of a {area} km² area around the selected point',
                arch_report_badge_premium: 'PREMIUM',
                arch_report_header_right: 'Premium analysis · APM 2.0 + potential zones + LIDAR',
                arch_report_footer_left: 'DetectLab — Archaeological Report · for guidance only, not an archaeological diagnosis',
                arch_report_page: 'Page',
                arch_report_generated_on: 'Generated on',
                arch_report_analysis_point: 'Analysis point',
                arch_report_area: 'Analysis area',
                arch_report_area_value: '{area} km² — a square of {side} km per side',
                arch_report_language: 'Language',
                arch_report_duration: 'Analysis time',
                arch_report_results_found: 'Selected results ({n})',
                arch_report_cover_intro_title: 'What this document is',
                arch_report_cover_intro: 'This report cross-references three DetectLab premium sources for one 5 km² area: the APM 2.0 prediction raster, the “archaeological potential zones” produced by triangulating the known sites, and the LIDAR Scanner annotations. Each candidate is scored as a weighted average of those three components, after the mandatory exclusions. The result is a ranked shortlist of places worth walking with a detector — not a prediction of what is buried there.',
                arch_report_sources_used: 'Data sources available for this analysis',
                arch_report_src_available: 'available',
                arch_report_src_unavailable: 'not available for this area',
                arch_report_src_unreadable: 'tiles present but pixels unreadable (CORS) — treated as unknown',
                arch_report_src_pot_state: '{n} zones inside the area ({total} in the 10 km working radius)',
                arch_report_src_lidar_state: '{n} annotated objects inside the area ({total} nearby)',
                arch_report_disclaimer: 'This document is produced automatically from public datasets (APM 2.0, UAT, RAN/CIMEC, LIDAR) and from DetectLab’s own statistical layers. It is an orientation tool for hobbyist and research use. It is not an archaeological diagnosis, it does not replace a specialist survey, and any fieldwork remains subject to the legal framework in force.',
                arch_report_method_title: 'Method',
                arch_report_sources_title: 'Data sources',
                arch_report_src_apm_title: 'APM 2.0',
                arch_report_src_apm_desc: 'The prediction raster published by DetectLab, scored 1 to 5 and rendered as a colour per score. For this report the colour under each candidate is matched to the nearest colour of the layer’s own legend, which is what turns a pixel into an approximate score.',
                arch_report_src_pot_title: 'Zones with archaeological potential',
                arch_report_src_pot_desc: 'The bubbles returned by the “archaeological potential” layer: gaps between the known sites, found by Delaunay triangulation of the RAN/CIMEC sites inside a 10 km working radius and scored on site density, average distance and triangle quality.',
                arch_report_src_lidar_title: 'LIDAR Scanner',
                arch_report_src_lidar_desc: 'The annotated anomalies of the DetectLab LIDAR Scanner (fortification, tumulus, burgus, unknown anomaly…). A candidate annotated on the scanner is returned automatically, whatever its APM 2.0 colour.',
                arch_report_exclusions_title: 'Mandatory exclusions',
                arch_report_excl_uat: '1. UAT — the candidate must sit on the red area of the UAT layer and be at least {dist} m away from the nearest non-red pixel (the built-up area). Inside a UAT or closer than {dist} m to one, a result is never returned.',
                arch_report_excl_sites: '2. Site radii — nothing is returned inside the protection radius of a known site: {radius} m of radius plus {buffer} m of clearance, i.e. {total} m. For polygon sites the same clearance is measured from points placed along the whole perimeter and from the centroid, exactly as the map draws those radii.',
                arch_report_excl_apm: '3. APM 2.0 below average — a candidate on khaki/olive (3), magenta (2) or red (1) is rejected. Only blue (5), green (4.5) and yellow (4) are accepted. The single exception is a point annotated on the LIDAR Scanner.',
                arch_report_score_title: 'The weighted score',
                arch_report_score_formula: 'score = {wapm}% · APM 2.0 + {wpot}% · potential zone + {wlidar}% · LIDAR',
                arch_report_weight_apm: 'Colour of the APM 2.0 pixel: blue 100%, green 85%, yellow 62%. Unreadable pixel: neutral 30%.',
                arch_report_weight_potential: 'Inside a potential zone: the score of that zone. Near one: that score attenuated by the distance. No zone in the area: neutral 25%.',
                arch_report_weight_lidar: 'Annotated on the scanner: 100% (plus a bonus). Near an anomaly: proportional to the distance. Nothing near: 10% (20% when the area has no LIDAR coverage at all).',
                arch_report_classify_title: 'Classification',
                arch_report_class_thresholds: 'Score ≥ {high}% = high potential · {medium}%–{high}% = medium potential · below {medium}% = low potential.',
                arch_report_area_stats_title: 'This analysis in numbers',
                arch_report_stat_sites: 'Known sites inside the 10 km working radius',
                arch_report_stat_bubbles: 'Potential zones (inside the area / total)',
                arch_report_stat_lidar: 'LIDAR objects (inside the area / nearby)',
                arch_report_stat_seeds: 'Candidate points tested',
                arch_report_stat_candidates: 'Candidates that passed every exclusion',
                arch_report_rejected_title: 'Candidates rejected, by reason',
                arch_report_rej_uat_not_red: 'Not on the red UAT area (inside the built-up zone)',
                arch_report_rej_uat_too_close: 'Closer than 500 m to the UAT',
                arch_report_rej_site_radius: 'Inside the protection radius of a known site',
                arch_report_rej_site_polygon: 'Inside a known site polygon',
                arch_report_rej_apm_below_average: 'APM 2.0 below average (khaki, magenta or red)',
                arch_report_tbl_indicator: 'Indicator',
                arch_report_tbl_value: 'Value',
                arch_report_tbl_reason: 'Reason',
                arch_report_tbl_component: 'Component',
                arch_report_tbl_weight: 'Weight',
                arch_report_tbl_how: 'How it is computed',
                arch_report_tbl_contribution: 'Contribution',
                arch_report_tbl_total: 'Total score',
                arch_report_how_score: 'How the score was computed',
                arch_report_apm_line: 'APM 2.0 colour: {cls} — component value {value}.',
                arch_report_apm_class_5: 'blue — score 5 (very high potential)',
                'arch_report_apm_class_4.5': 'green — score 4.5 (high potential)',
                arch_report_apm_class_4: 'yellow — score 4 (moderate potential)',
                arch_report_apm_class_3: 'khaki/olive — score 3 (low potential)',
                arch_report_apm_class_2: 'magenta — score 2 (minimal potential)',
                arch_report_apm_class_1: 'red — score 1 (no potential)',
                arch_report_apm_class_0: 'no readable data',
                arch_report_apm_explain_5: 'The raster reads this ground as blue, score 5. In practical terms the model sees a relatively flat surface, close to water, on a substrate supported by the geological factors it was trained on — the combination that kept attracting settlements for millennia. That colour is converted here into an approximate APM score of 100% for this component.',
                arch_report_apm_explain_45: 'The raster reads this ground as green, score 4.5. The setting is close to the best one: terrain that is still relatively flat, water within reach and favourable geological conditions, with slightly less support than the blue class. Approximate APM score: 85%.',
                arch_report_apm_explain_4: 'The raster reads this ground as yellow, score 4. The context is moderately favourable — the relief is workable and water is not far, but the geological support is weaker than in the green or blue classes. Approximate APM score: 62%.',
                arch_report_apm_explain_unknown: 'The APM 2.0 pixel under this point could not be read (missing tile, or pixel access blocked by the tile host), so this component receives a neutral baseline instead of a colour-derived score.',
                arch_report_apm_explain_unknown_waived: 'The APM 2.0 pixel under this point could not be read, but the point is annotated on the LIDAR Scanner: the APM condition is therefore waived and a neutral baseline is used for that component.',
                arch_report_pot_inside_long: 'The point falls inside one of the potential zones returned by the triangulation layer, which scores that zone at {score}; the whole weight of this component comes from that bubble.',
                arch_report_pot_near_long: 'The nearest potential zone is {dist} away and is scored {score}; the component is that score attenuated by the distance.',
                arch_report_pot_none_long: 'No potential zone is close enough to contribute ({n} zones inside the 5 km² area), so the component falls back to the neutral baseline.',
                arch_report_pot_factors: 'That zone was derived from {nearby} known sites within 1.5 km, an average distance of {avg} to the five nearest sites, a density of {density} sites within 3 km, a closest site at {closest} and a triangle quality of {tri}.',
                arch_report_lidar_section_title: 'LIDAR Scanner',
                arch_report_lidar_hit_long: 'This point is annotated on the LIDAR Scanner as “{title}”, so it is returned automatically and this component is scored at 100%. The APM 2.0 colour condition is waived for it.',
                arch_report_lidar_near_long: 'The nearest LIDAR Scanner object (“{title}”) is {dist} away, so this component is scored proportionally to that proximity.',
                arch_report_lidar_none_long: 'No LIDAR Scanner object is close to this point, so this component falls back to its baseline.',
                arch_report_uat_line_title: 'UAT check',
                arch_report_uat_ok_long: 'The point sits on the red area of the UAT layer (outside the built-up zone) and the nearest non-red pixel — the UAT itself — is {dist} away, which satisfies the mandatory 500 m clearance.',
                arch_report_period_title: 'Estimated period',
                arch_report_period_line: 'Most likely period: {period} (agreement {confidence}%).',
                arch_report_period_explain: 'The estimate is an inverse-distance weighted vote over the dating recorded for the nearest known sites — a triangulation in time, mirroring the spatial triangulation that produced the potential zones. It is an indication, not a diagnosis; the sites behind it are listed below.',
                arch_report_period_none: 'The nearest known sites carry no usable dating, so no period can be estimated for this point.',
                arch_report_period_evidence: 'Sites used for the estimate',
                arch_report_period_unknown: 'Undetermined',
                arch_report_sites_title: 'Nearest known sites',
                arch_report_sites_note: 'Distances are measured to the site geometry; for polygon sites, to the nearest point of their boundary. The links open the RAN / CIMEC record.',
                arch_report_tbl_site: 'Site',
                arch_report_tbl_period: 'Period',
                arch_report_tbl_type: 'Type',
                arch_report_tbl_dist: 'Distance',
                arch_report_tbl_link: 'RAN / CIMEC',
                arch_report_tbl_result: 'Result',
                arch_report_tbl_class: 'Classification',
                arch_report_tbl_coords: 'Coordinates',
                arch_report_figures_title: 'Explanatory figures',
                arch_report_fig_apm_title: 'APM 2.0 view of the area (30% opacity)',
                arch_report_fig_apm_caption: 'The APM 2.0 raster at 30% opacity over the satellite image, exactly as the layer is normally read. The orange square is the 5 km² analysis area; the orange polygons are the results.',
                arch_report_fig_lidar_title: 'LIDAR view of the area',
                arch_report_fig_lidar_caption: 'The area over the active LIDAR hillshade, with the LIDAR Scanner annotations in green. This figure is included because at least one scanner object lies in the area.',
                arch_report_fig_potential_title: 'Potential zones compared with the known sites',
                arch_report_fig_potential_caption: 'The purple circles are the potential zones returned by the triangulation layer, drawn against the known sites (violet points, red polygons). This figure is included because the area contains at least one such zone.',
                arch_report_fig_potential_badge: 'Triangulation',
                arch_report_fig_satellite: 'Satellite',
                arch_report_fig_sources: 'Sources drawn: {list}',
                arch_report_fig_missing: 'Not drawn (pixels unreadable / not requested): {list}',
                arch_report_sources_page_title: 'Sources, legend and limits',
                arch_report_provenance_title: 'Data provenance',
                arch_report_legend_title: 'Map legend used in the figures',
                arch_report_legend_apm: 'APM 2.0: blue = 5, green = 4.5, yellow = 4, khaki/olive = 3, magenta = 2, red = 1. Only blue, green and yellow can host a result.',
                arch_report_legend_results: 'Orange dashed square = the 5 km² analysis area. Orange polygons = the returned results, labelled Result 1/2/3.',
                arch_report_legend_potential: 'Purple circles = potential zones from the triangulation layer. Violet points = known point sites, red polygons = known site boundaries (RAN / CIMEC).',
                arch_report_disclaimer_title: 'Limits and legal note',
                arch_report_disclaimer_full: 'The scores are statistical, not predictive: they describe how similar a location is to the places where sites are already known, and how well it matches the APM 2.0 model. Absence of a result does not mean absence of archaeology, and a high score does not guarantee a find. Fieldwork in Romania is regulated: surface surveying with a metal detector requires the authorisations provided by law, and any archaeological find must be reported. DetectLab declines any responsibility for use of this document outside that framework.',
                arch_report_generated_by: 'Generated automatically by DetectLab — js/archeo-report.js',
                arch_period_paleolithic: 'Palaeolithic',
                arch_period_mesolithic: 'Mesolithic',
                arch_period_neolithic: 'Neolithic',
                arch_period_eneolithic: 'Eneolithic (Chalcolithic)',
                arch_period_bronze_age: 'Bronze Age',
                arch_period_hallstatt: 'Hallstatt (Early Iron Age)',
                arch_period_iron_age: 'Iron Age',
                arch_period_dacian: 'Dacian / Geto-Dacian',
                arch_period_roman: 'Roman',
                arch_period_migration: 'Migration Period',
                arch_period_medieval: 'Medieval',
                arch_period_modern: 'Modern',
                arch_period_prehistoric: 'Prehistoric (generic)',
                arch_period_antiquity: 'Antiquity (generic)',
                
                
                iosfree_hint: 'Search or zoom into a locality',
                iosfree_loading: 'Loading image…',
                iosfree_notfound: 'No map found for this locality',
                iosfree_zoom: 'Zoom ≥ 13 or search a locality to activate',
                iosfree_search_btn: 'Search here',
                hist_zoom_hint: 'Zoom in to see map',
                apm20_search_help: 'Search Help',
                apm20_search_help_loading: 'Analyzing visible area…',
                apm20_search_help_empty: 'No clear high-potential zones found in the visible area',
                apm20_search_help_error: 'Could not analyze the visible area, please try again',
                apm20_search_help_zoom: 'Zoom in more to use Search Help',
                apm20_search_help_hint: 'Zoom in for advanced search',
                ios_bld_search_help: 'Vanished Buildings',
                ios_bld_search_help_loading: 'Analyzing Josephine Map +…',
                ios_bld_search_help_empty: 'No vanished building zones found in visible area',
                ios_bld_search_help_error: 'Enable Josephine Map + layer first',
                ios_bld_search_help_hint: 'Zoom in more',
                ios_bld_search_help_zoom: 'Zoom in more',
                ios_bld_search_help_zoom_in: 'Zoom in more',
                ios_bld_search_help_zoom_out: 'Zoom out more',
            },
            ro: {
                nav_apm: 'Ce este APM', nav_map: 'Explorează Harta', nav_how: 'Cum Funcționează', nav_pricing: 'Prețuri', nav_useful: 'Informații Utile', nav_cta: 'Obține Acces',
                hero_badge: 'Arheologie × Inteligență Artificială', hero_tagline: 'Salvăm Istoria Împreună',
                hero_desc: 'Un Model de Predicție Arheologică care identifică automat zonele cu potențial ridicat pentru așezări antice — folosind date topografice, geologice și hidrografice colectate de la începuturile civilizației.',
                hero_btn1: '🗺 Explorează Harta', hero_btn2: 'Vezi Planurile de Abonament', scroll: 'Derulează pentru a descoperi',
                what_label: 'Tehnologie', what_title: 'Ce este un <span class="hl">Model de Predicție Arheologică</span>?',
                what_desc: 'Gândește-l ca pe o hartă inteligentă care citește peisajul ca un arheolog. În loc să petreci ani întregi mergând prin câmpuri și săpând aleatoriu, APM-ul analizează mii de variabile de mediu pentru a-ți spune: <em>aici au trăit oamenii.</em>',
                card1_title: '🏔 Analiză Topografică', card1_desc: 'Altitudine, pantă și relief — așezările antice preferau terenuri înalte, ușor apărabile și pante sudice blânde, aproape de resurse.',
                card2_title: '💧 Proximitate Hidrografică', card2_desc: 'Distanța față de râuri, izvoare și zone umede — fiecare civilizație din istorie s-a așezat în apropierea apei dulci. Modelul cartografiază aceste coridoare antice.',
                card3_title: '🪨 Condiții Geologice', card3_desc: 'Fertilitatea solului, stabilitatea substratului și disponibilitatea mineralelor — factori care au determinat migrațiile umane și așezările permanente timp de 10.000 de ani.',
                leg5: 'Scor 5.0 — Potențial Foarte Ridicat', leg4: 'Scor 4.0 — Potențial Ridicat', leg3: 'Scor 3.1 — Potențial Moderat', leg2: 'Scor 2.1 — Potențial Scăzut', leg1: 'Scor 1.2 — Potențial Minimal',
                apm20_leg5: 'Scor 5 — Potențial Foarte Ridicat', apm20_leg4: 'Scor 4.5 — Potențial Ridicat', apm20_leg3: 'Scor 4 — Potențial Moderat', apm20_leg2: 'Scor 3 — Potențial Scăzut', apm20_leg2b: 'Scor 2 — Potențial Minimal', apm20_leg1: 'Scor 1 — Fără Potențial',
                map_label: 'Hartă Live', map_title: 'Explorează <span class="hl">Stratul APM</span>',
                tab_free: '🔓 Previzualizare Gratuită', tab_member: '🔐 Harta Membrilor',
                manage_account: 'Gestionează Contul',
                nav_events: 'Evenimente', nav_logout: 'Deconectare',
                lock_title: 'Hartă Exclusivă Membrilor', lock_desc: 'Abonează-te pentru a debloca straturi APM la rezoluție completă, filtre avansate și instrumente de export.', lock_btn: 'Vezi Planuri',
                apm_score: 'Scor APM:',
                how_label: 'Proces', how_title: 'Cum Funcționează <span class="hl">DetectLab</span>',
                step1_title: 'Colectare Date', step1_desc: 'Agregăm seturi de date topografice, hidrografice și geologice din surse naționale și internaționale.',
                step2_title: 'Modelare în QGIS', step2_desc: 'Straturile sunt procesate și ponderate în QGIS folosind algoritmi spațiali.',
                step3_title: 'Atribuire scor și Clasificare', step3_desc: 'Fiecare zonă primește un scor APM de la 1 la 5.0 reprezentând probabilitatea de a conține vestigii arheologice îngropate.',
                step4_title: 'Hartă Interactivă', step4_desc: 'Rezultatele sunt publicate ca hartă web interactivă suprapusă pe imagini satelitare — gata pentru cercetători, instituții și entuziaști.',
                pricing_label: 'Abonament', pricing_title: 'Alege <span class="hl">Planul Tău</span>', pricing_desc: 'Fie că ești amator, cercetător sau instituție — DetectLab are un plan pentru tine.',
                lbl_weekly: 'Săptămânal', lbl_monthly: 'Lunar', save_badge: 'Economisești până la 45%',
                tier_bronze: 'Bronz', tier_silver: 'Argint', tier_gold: 'Aur',
                plan_weekly: 'Săptămânal', plan_monthly: 'O lună', plan_yearly: 'Anual',
                note_weekly: 'Indisponibil', note_monthly: 'Plată unică', note_yearly: 'Indisponibil',
                badge_popular: 'Cel Mai Popular',
                not_available: 'Indisponibil',
                f_map: 'Hartă APM interactivă completă', f_sat: 'Suprapunere satelit + APM', f_legend: 'Legendă scoruri & info zone',
                f_export: 'Export date (GeoJSON, KMZ)', f_filters: 'Filtre avansate de straturi', f_api: 'Acces API', f_api_plus: 'Acces API + suport prioritar',
                btn_bronze: 'Cumpără', btn_silver: 'Cumpără', btn_gold: 'Cumpără',
                free_title: 'Gratuit — Mereu Disponibil', free_desc: 'Explorează o previzualizare limitată a hărții APM, citește despre metodologie și înțelege ce poate face predicția arheologică pentru cercetare.', free_btn: 'Explorează Harta Gratuită',
                // ── Premium membership ──
                prem_modal_title: 'DetectLab Premium',
                prem_modal_sub: 'Deblochează toate straturile premium de pe harta interactivă.',
                prem_login_needed: 'Ai nevoie de un cont gratuit ca să cumperi Premium. Autentifică-te sau înregistrează-te — durează un minut.',
                prem_login_btn: 'Autentificare / Înregistrare',
                prem_already: 'Luna ta de Premium este încă activă. Îți mulțumim că susții DetectLab!',
                prem_feat_apm20: 'APM 2.0 — model avansat de predicție arheologică',
                prem_feat_hist: 'Hărți istorice — Iosefină +, Bucovina 1861–1864, austro-ungară, WWI, WWII',
                prem_feat_lidar: 'LIDAR Scanner — analiza norului de puncte în jurul oricărei locații',
                prem_feat_archeo: 'Potențial Arheologic — analiza automată a zonelor candidate',
                prem_feat_roman: 'Straturile Imperiului Roman — drumuri, forturi și așezări',
                prem_price_line: '5 € <small class="vat-note">+TVA</small> pentru o lună — fără reînnoire automată',
                prem_buy_btn: 'Cumpără Premium · 5 € <small class="vat-note">+TVA</small> pentru o lună',
                prem_later: 'Acum nu',
                prem_manage: 'Gestionează abonamentul',
                prem_panel_locked: 'Straturile premium sunt blocate',
                prem_panel_desc: 'Devino membru Premium pentru a debloca toate straturile și instrumentele.',
                prem_panel_cta: 'Devino membru premium',
                prem_layer_locked_label: 'Strat premium blocat',
                babel_title: 'Dosarul istoric al localității',
                // ── Checkout page ──
                co_back_map: 'Înapoi la hartă',
                co_login_title: 'Autentifică-te pentru a continua',
                co_login_desc: 'Ai nevoie de un cont pentru a cumpăra Premium.',
                co_login_btn: 'Mergi la autentificare',
                co_order_title: 'Rezumat comandă',
                co_plan_name: 'DetectLab Premium — o lună',
                co_all_layers: 'Toate straturile premium de pe hartă',
                co_total: 'Total de plată astăzi',
                co_period_once: 'plată unică',
                co_renews: '5 € <small class="vat-note">+TVA</small> pentru o lună — fără reînnoire automată',
                co_no_renewal: 'Fără reînnoire automată — nu vei mai fi taxat.',
                co_pay_title: 'Metodă de plată',
                co_pay_by: 'Plătește în siguranță cu',
                co_pay_btn: 'Plătește 5,00 € <small class="vat-note">+TVA</small>',
                co_stripe_note: 'Cardurile, Apple Pay și Google Pay sunt acceptate pe pagina securizată de plată Stripe.',
                co_redirecting: 'Te redirecționăm către pagina securizată de plată Stripe…',
                co_processing: 'Confirmăm plata…',
                co_processing_desc: 'De obicei durează câteva secunde.',
                co_cancelled: 'Plată anulată — nu ai fost taxat.',
                co_portal_return: 'Setările de facturare au fost actualizate.',
                co_pending_title: 'Plată primită — se activează Premium…',
                co_pending_desc: 'De obicei durează câteva secunde. Dacă nu se activează, verifică din nou sau mergi la contul tău.',
                co_check_again: 'Verifică din nou',
                co_already_title: 'Ești deja Premium',
                co_already_desc: 'Luna ta de Premium este încă activă. Poți cumpăra încă o lună după ce se termină.',
                co_manage_billing: 'Gestionează abonamentul',
                co_not_configured: 'Plățile nu sunt încă configurate. Încearcă din nou mai târziu.',
                co_login_needed: 'Autentifică-te mai întâi.',
                co_secure: 'Plățile sunt criptate și procesate în siguranță.',
                co_success_title: 'Plată confirmată!',
                co_success_desc: 'Contul tău este Premium pentru o lună. Bucură-te de toate straturile premium.',
                co_success_expiry: 'Premium activ până pe',
                co_go_account: 'Mergi la contul meu',
                co_footer: 'DetectLab · Salvăm istoria împreună',
                // ── Coduri promoționale (perioadă de probă) ──
                promo_or: 'sau',
                promo_have_code: 'Ai un cod promoțional?',
                promo_label: 'Cod promoțional',
                promo_redeem_btn: 'Activează',
                promo_hint: 'Deblochează Premium instant — fără plată.',
                promo_success: 'Cod activat! Premium este activ până pe {date}.',
                promo_success_title: 'Cod promoțional activat!',
                promo_success_desc: 'Premium este deblocat pe contul tău — nu ai fost taxat.',
                promo_go_map: 'Explorează harta',
                promo_err_invalid: 'Acest cod promoțional nu este valid. Verifică-l și încearcă din nou.',
                promo_err_expired: 'Acest cod promoțional a expirat.',
                promo_err_not_started: 'Acest cod promoțional nu este încă activ.',
                promo_err_exhausted: 'Acest cod promoțional și-a atins limita.',
                promo_err_already_redeemed: 'Ai folosit deja acest cod promoțional.',
                promo_err_trial_used: 'Contul tău a folosit deja perioada gratuită de probă.',
                promo_err_already_premium: 'Premium este încă activ — nu ai nevoie de cod deocamdată.',
                promo_err_too_many: 'Prea multe încercări. Încearcă din nou peste câteva minute.',
                promo_err_login: 'Autentifică-te pentru a folosi un cod promoțional.',
                promo_err_generic: 'Codul nu a putut fi activat. Încearcă din nou.',
                // ── Account / subscription ──
                acct_subscription: 'Premium',
                acct_buy_premium: 'Cumpără Premium · 5 € <small class="vat-note">+TVA</small> pentru o lună',
                acct_renew: 'Cumpără încă o lună',
                acct_manage: 'Gestionează abonamentul',
                acct_expires_on: 'Expiră pe',
                acct_premium_until: 'Premium până pe {date}',
                acct_days_left: '{n} zile rămase',
                acct_day_left: '{n} zi rămasă',
                acct_no_sub: 'Premium inactiv',
                acct_no_renewal: '5 € <small class="vat-note">+TVA</small> pentru o lună — fără reînnoire automată',
                f_product: 'Produs', f_resources: 'Resurse', f_contact: 'Contact',
                f_method: 'Metodologie', f_docs: 'Documentație', f_papers: 'Articole Științifice', f_qgis: 'Proiect QGIS',
                f_about: 'Despre Noi', f_partner: 'contact@detectlab.ro', f_press: 'Presă',
                get_app_label: 'Aplicație Mobilă',
                get_app_title: 'Obține Aplicația <span class="hl">DetectLab</span>',
                get_app_desc: 'Instalează aplicația pe dispozitivul tău mobil pentru acces rapid la modelul de predicție.',
                btn_android: 'Aplicație Android',
                btn_ios: 'Aplicație iOS',
                footer_desc: 'Salvăm istoria împreună!',
                f_rights: 'Toate drepturile rezervate.', f_built: 'Construit cu QGIS · OpenLayers · pasiune pentru trecut',
                layer_opacity: 'Opacitate Straturi',
                layer_satellite: 'Satelit',
                layer_osm_places: 'Localități OSM',
                layer_uat: 'UAT',
                layer_heritage: 'Patrimoniu',
                heritage_legend_title: 'Legendă',
                heritage_legend_red: 'Situri cu coordonate corecte',
                heritage_legend_green: 'Situri cu coordonate aproximate',
                heritage_legend_yellow: 'Tumul',
                layer_opacity_label: 'Opacitate',
                layer_roman: 'Imperiul Roman',
                layer_roads: 'Drumuri',
                layer_vici_sites: 'Situri Romane (DARE)',
                layer_dare_11: 'Așezări majore',
                layer_dare_17: 'Forturi majore',
                layer_dare_13: 'Capitale Civitas',
                layer_dare_12: 'Așezări obișnuite',
                layer_dare_18: 'Forturi/Castrum',
                layer_dare_53: 'Fortulețe/Turnuri',
                layer_dare_16: 'Stații rutiere/de coastă',
                layer_dare_61: 'Sanctuare/Temple',
                layer_dare_66: 'Băi',
                layer_dare_32: 'Tumuli',
                layer_dare_63: 'Cimitire',
                layer_dare_21: 'Mănăstiri',
                layer_dare_24: 'Biserici',
                layer_dare_14: 'Vile',
                layer_dare_57: 'Mine/Cariere',
                layer_dare_49: 'Trecători',
                layer_dare_51: 'Poduri',
                layer_dare_55: 'Drumuri/Borne miliare',
                layer_dare_52: 'Apeducte',
                layer_dare_64: 'Monumente',
                layer_urban_areas: 'Zone urbane',
                layer_aqueducts: 'Apeducte',
                layer_walls: 'Ziduri',
                layer_regional_names: 'Denumiri regionale',
                layer_political_shading: 'Colorare Politică',
                layer_re_117: 'IR 117 d.Hr.',
                layer_re_60bce: 'IR 60 î.Hr.',
                layer_re_200: 'IR 200 d.Hr.',
                layer_alexander: 'Imperiul lui Alexandru',
                layer_persian: 'Imperiul Persan',
                layer_diocletian: 'Prov. după Dioclețian',
                layer_historical: 'Hărți Istorice',
                layer_historical_premium: 'Harti istorice',
                layer_josephine: 'Harta Iosefină +',
                layer_iosfree: 'Harta Iosefină',
                layer_austrian: 'Harta Austriacă 1910',
                layer_firingplans: 'Planuri de Tragere',
                layer_sovietmap: 'Harta Sovietică 1970',
                layer_bucovina: 'Bucovina 1861-1864',
                layer_austrohu: 'Harta Austro-Ungară (1861–1864)',
                layer_moldova1868: 'Moldova 1868',
                layer_moldovawwii: 'Moldova WWII',
                layer_polishtactical1933: 'Harta tactică poloneză 1933',
                layer_ww1: 'WWI',
                layer_ww2: 'WWII',
                layer_satellite60s: "Imagini satelitare anii 60'",
                layer_banat: 'Banat - 1769-1772',
                layer_archeo_potential: 'Zone cu potențial arheologic',
                archeo_desc: 'Analiză statistică · rază 10 km',
                archeo_run_btn: 'Zone candidati',
                archeo_run_running: 'Se analizează…',
                archeo_status_ready: 'Apasă butonul pentru a analiza raza de 10 km curentă.',
                archeo_legend_medium: 'Potențial Mediu',
                archeo_legend_high: 'Potențial Ridicat',
                archeo_hint: 'Candidații = goluri între siturile cunoscute, în zona roșie UAT, la ≥ 700 m de orice sit.',
                archeo_show_label: 'Arată rezultatele',
                // ── Premium: Archeological Report / Raport arheologic (js/archeo-report.js) ──
                layer_arch_report: 'Raport arheologic',
                arch_report_desc: '5 km² · APM 2.0 + zone cu potențial + LIDAR · PDF',
                arch_report_hint: 'Pornește stratul și alege un punct pe hartă.',
                arch_report_hint_bottom: 'Sunt excluse: punctele din UAT sau la mai puțin de 500 m de UAT, cele din radiusurile siturilor cunoscute și cele cu APM 2.0 sub medie (kaki → roșu) — cu excepția celor adnotate pe LIDAR.',
                arch_report_run_btn: 'Generează raportul',
                arch_report_run_running: 'Se analizează…',
                arch_report_pdf_btn: 'Descarcă PDF',
                arch_report_show_results: 'Arată rezultatele pe hartă',
                arch_report_need_point: 'Alege mai întâi un punct pe hartă.',
                arch_report_point_set: 'Punct de analiză: {lat}, {lng} — apasă „Generează raportul”.',
                arch_report_point_title: 'Punct raport',
                arch_report_step_sites: 'Se încarcă siturile arheologice cunoscute…',
                arch_report_step_potential: 'Se triangulează zonele cu potențial…',
                arch_report_step_lidar: 'Se citesc adnotările LIDAR Scanner…',
                arch_report_step_uat: 'Se citește stratul UAT (zona roșie + 500 m)…',
                arch_report_step_apm: 'Se citesc culorile APM 2.0…',
                arch_report_step_scoring: 'Se punctează candidații…',
                arch_report_done: 'Analiză finalizată — rezultatele sunt pe hartă.',
                arch_report_no_results: 'Niciun rezultat nu a trecut filtrele în această zonă. Încearcă alt punct.',
                arch_report_error: 'Analiza a eșuat — vezi consola pentru detalii.',
                arch_report_need_results: 'Rulează mai întâi analiza.',
                arch_report_summary_detail: '{seeds} puncte testate · {passed} au trecut filtrele · {bubbles} zone cu potențial · {lidar} obiecte LIDAR în zonă',
                arch_report_pdf_capturing: 'Se pregătesc capturile…',
                arch_report_pdf_building: 'Se construiește PDF-ul…',
                arch_report_pdf_done: 'PDF gata: {name} ({pages} pagini).',
                arch_report_result: 'Rezultat',
                arch_report_score: 'Scor',
                arch_report_class_high: 'Potențial ridicat',
                arch_report_class_medium: 'Potențial mediu',
                arch_report_class_low: 'Potențial scăzut',
                arch_report_row_apm: 'APM 2.0',
                arch_report_row_potential: 'Zonă cu potențial',
                arch_report_row_lidar: 'LIDAR',
                arch_report_row_uat: 'UAT',
                arch_report_row_period: 'Perioadă estimată',
                arch_report_pot_inside: 'într-o zonă cu scor {score}',
                arch_report_pot_near: 'la {dist} de o zonă cu scor {score}',
                arch_report_pot_none: 'nicio zonă de triangulare aproape',
                arch_report_lidar_hit: 'adnotat pe LIDAR — {title}',
                arch_report_lidar_near: 'obiect LIDAR la {dist}',
                arch_report_lidar_none: 'niciun obiect LIDAR aproape',
                arch_report_uat_ok: 'zonă roșie · ≥ {dist} față de UAT',
                arch_report_closest_site: 'Cel mai apropiat sit',
                arch_report_popup_hint: 'Descarcă PDF-ul pentru explicația completă.',
                arch_report_site_unknown: 'Sit nedenumit',
                arch_report_flag_lidar: 'adnotat pe LIDAR Scanner',
                arch_report_title: 'Raport arheologic',
                arch_report_subtitle: 'Analiză DetectLab pentru o zonă de {area} km² în jurul punctului ales',
                arch_report_badge_premium: 'PREMIUM',
                arch_report_header_right: 'Analiză premium · APM 2.0 + zone cu potențial + LIDAR',
                arch_report_footer_left: 'DetectLab — Raport arheologic · document de orientare, nu diagnostic arheologic',
                arch_report_page: 'Pagina',
                arch_report_generated_on: 'Generat la',
                arch_report_analysis_point: 'Punct de analiză',
                arch_report_area: 'Zona analizată',
                arch_report_area_value: '{area} km² — pătrat cu latura de {side} km',
                arch_report_language: 'Limbă',
                arch_report_duration: 'Durata analizei',
                arch_report_results_found: 'Rezultate selectate ({n})',
                arch_report_cover_intro_title: 'Ce este acest document',
                arch_report_cover_intro: 'Raportul combină trei surse premium DetectLab pentru o zonă de 5 km²: rasterul de predicție APM 2.0, „zonele cu potențial arheologic” obținute prin triangularea siturilor cunoscute și adnotările LIDAR Scanner. Fiecare candidat primește un scor calculat ca medie ponderată a celor trei componente, după aplicarea excluderilor obligatorii. Rezultatul este o scurtă listă ordonată a locurilor care merită parcurse cu detectorul — nu o predicție a ceea ce se află în pământ.',
                arch_report_sources_used: 'Surse de date disponibile pentru această analiză',
                arch_report_src_available: 'disponibil',
                arch_report_src_unavailable: 'indisponibil pentru această zonă',
                arch_report_src_unreadable: 'tile-uri prezente, dar pixeli ilizibili (CORS) — tratat ca necunoscut',
                arch_report_src_pot_state: '{n} zone în interiorul ariei ({total} în raza de lucru de 10 km)',
                arch_report_src_lidar_state: '{n} obiecte adnotate în interiorul ariei ({total} în apropiere)',
                arch_report_disclaimer: 'Document generat automat din seturi de date publice (APM 2.0, UAT, RAN/CIMEC, LIDAR) și din straturile statistice DetectLab. Este un instrument de orientare pentru pasionați și cercetare. Nu este un diagnostic arheologic, nu înlocuiește o cercetare de specialitate, iar orice activitate pe teren rămâne supusă cadrului legal în vigoare.',
                arch_report_method_title: 'Metodă',
                arch_report_sources_title: 'Surse de date',
                arch_report_src_apm_title: 'APM 2.0',
                arch_report_src_apm_desc: 'Rasterul de predicție publicat de DetectLab, cu scor de la 1 la 5, randat câte o culoare per scor. Pentru raport, culoarea de sub fiecare candidat este comparată cu cea mai apropiată culoare din legenda stratului — așa devine un pixel un scor aproximativ.',
                arch_report_src_pot_title: 'Zone cu potențial arheologic',
                arch_report_src_pot_desc: 'Bulele returnate de stratul „zone cu potențial arheologic”: golurile dintre siturile cunoscute, găsite prin triangulare Delaunay a siturilor RAN/CIMEC dintr-o rază de lucru de 10 km și punctate după densitatea siturilor, distanța medie și calitatea triunghiurilor.',
                arch_report_src_lidar_title: 'LIDAR Scanner',
                arch_report_src_lidar_desc: 'Anomaliile adnotate din LIDAR Scanner DetectLab (fortificație, tumul, burgus, anomalie necunoscută…). Un candidat adnotat pe scanner este returnat automat, indiferent de culoarea APM 2.0.',
                arch_report_exclusions_title: 'Excluderi obligatorii',
                arch_report_excl_uat: '1. UAT — candidatul trebuie să fie pe zona roșie a stratului UAT și la cel puțin {dist} m de cel mai apropiat pixel non-roșu (zona construită). În UAT sau la mai puțin de {dist} m de UAT nu se returnează niciun rezultat.',
                arch_report_excl_sites: '2. Radiusurile siturilor — nu se returnează nimic în raza de protecție a unui sit cunoscut: {radius} m rază plus {buffer} m distanțare, adică {total} m. Pentru siturile tip poligon, aceeași distanțare se măsoară din puncte plasate pe întreg conturul și din centroid, exact cum desenează harta acele raze.',
                arch_report_excl_apm: '3. APM 2.0 sub medie — un candidat pe kaki/maro (3), roz (2) sau roșu (1) este respins. Sunt acceptate doar albastru (5), verde (4.5) și galben (4). Singura excepție este un punct adnotat pe LIDAR Scanner.',
                arch_report_score_title: 'Scorul ponderat',
                arch_report_score_formula: 'scor = {wapm}% · APM 2.0 + {wpot}% · zonă cu potențial + {wlidar}% · LIDAR',
                arch_report_weight_apm: 'Culoarea pixelului APM 2.0: albastru 100%, verde 85%, galben 62%. Pixel ilizibil: neutru 30%.',
                arch_report_weight_potential: 'Într-o zonă cu potențial: scorul acelei zone. Aproape de una: scorul ei atenuat cu distanța. Nicio zonă în arie: neutru 25%.',
                arch_report_weight_lidar: 'Adnotat pe scanner: 100% (plus bonus). Aproape de o anomalie: proporțional cu distanța. Nimic aproape: 10% (20% dacă zona nu are deloc acoperire LIDAR).',
                arch_report_classify_title: 'Clasificare',
                arch_report_class_thresholds: 'Scor ≥ {high}% = potențial ridicat · {medium}%–{high}% = potențial mediu · sub {medium}% = potențial scăzut.',
                arch_report_area_stats_title: 'Analiza în cifre',
                arch_report_stat_sites: 'Situri cunoscute în raza de lucru de 10 km',
                arch_report_stat_bubbles: 'Zone cu potențial (în arie / total)',
                arch_report_stat_lidar: 'Obiecte LIDAR (în arie / în apropiere)',
                arch_report_stat_seeds: 'Puncte candidate testate',
                arch_report_stat_candidates: 'Candidați care au trecut de toate excluderile',
                arch_report_rejected_title: 'Candidați respinși, pe motive',
                arch_report_rej_uat_not_red: 'Nu este pe zona roșie UAT (în interiorul zonei construite)',
                arch_report_rej_uat_too_close: 'La mai puțin de 500 m de UAT',
                arch_report_rej_site_radius: 'În raza de protecție a unui sit cunoscut',
                arch_report_rej_site_polygon: 'În interiorul unui poligon de sit cunoscut',
                arch_report_rej_apm_below_average: 'APM 2.0 sub medie (kaki, roz sau roșu)',
                arch_report_tbl_indicator: 'Indicator',
                arch_report_tbl_value: 'Valoare',
                arch_report_tbl_reason: 'Motiv',
                arch_report_tbl_component: 'Componentă',
                arch_report_tbl_weight: 'Pondere',
                arch_report_tbl_how: 'Cum se calculează',
                arch_report_tbl_contribution: 'Contribuție',
                arch_report_tbl_total: 'Scor total',
                arch_report_how_score: 'Cum a fost calculat scorul',
                arch_report_apm_line: 'Culoare APM 2.0: {cls} — valoarea componentei {value}.',
                arch_report_apm_class_5: 'albastru — scor 5 (potențial foarte ridicat)',
                'arch_report_apm_class_4.5': 'verde — scor 4.5 (potențial ridicat)',
                arch_report_apm_class_4: 'galben — scor 4 (potențial moderat)',
                arch_report_apm_class_3: 'kaki/maro — scor 3 (potențial scăzut)',
                arch_report_apm_class_2: 'roz — scor 2 (potențial minim)',
                arch_report_apm_class_1: 'roșu — scor 1 (fără potențial)',
                arch_report_apm_class_0: 'fără date lizibile',
                arch_report_apm_explain_5: 'Rasterul citește acest teren ca albastru, scor 5. Practic, modelul vede un relief relativ plat, aproape de apă, pe un substrat susținut de factorii geologici pe care a fost antrenat — combinația care a atras așezări milenii la rând. Culoarea este transformată aici într-un scor APM aproximativ de 100% pentru această componentă.',
                arch_report_apm_explain_45: 'Rasterul citește acest teren ca verde, scor 4.5. Contextul e aproape de cel optim: teren încă relativ plat, apă în apropiere și condiții geologice favorabile, cu un sprijin ușor mai mic decât la clasa albastră. Scor APM aproximativ: 85%.',
                arch_report_apm_explain_4: 'Rasterul citește acest teren ca galben, scor 4. Contextul este moderat favorabil — relieful este practicabil și apa nu este departe, dar sprijinul geologic este mai slab decât la clasele verde sau albastru. Scor APM aproximativ: 62%.',
                arch_report_apm_explain_unknown: 'Pixelul APM 2.0 de sub acest punct nu a putut fi citit (tile lipsă sau acces la pixeli blocat de gazda tile-urilor), așa că această componentă primește o valoare neutră în locul unui scor derivat din culoare.',
                arch_report_apm_explain_unknown_waived: 'Pixelul APM 2.0 de sub acest punct nu a putut fi citit, dar punctul este adnotat pe LIDAR Scanner: condiția APM este, prin excepție, înlăturată, iar componenta folosește o valoare neutră.',
                arch_report_pot_inside_long: 'Punctul cade în interiorul uneia dintre zonele cu potențial returnate de stratul de triangulare, care punctează acea zonă cu {score}; întreaga pondere a componentei vine din acea bulă.',
                arch_report_pot_near_long: 'Cea mai apropiată zonă cu potențial este la {dist} și are scorul {score}; componenta este acel scor atenuat cu distanța.',
                arch_report_pot_none_long: 'Nicio zonă cu potențial nu este suficient de aproape ca să contribuie ({n} zone în aria de 5 km²), deci componenta revine la valoarea neutră.',
                arch_report_pot_factors: 'Zona respectivă a fost derivată din {nearby} situri cunoscute în rază de 1,5 km, o distanță medie de {avg} până la cele mai apropiate cinci situri, o densitate de {density} situri în 3 km, cel mai apropiat sit la {closest} și o calitate a triunghiului de {tri}.',
                arch_report_lidar_section_title: 'LIDAR Scanner',
                arch_report_lidar_hit_long: 'Acest punct este adnotat pe LIDAR Scanner ca „{title}”, deci este returnat automat, iar componenta primește 100%. Condiția de culoare APM 2.0 este înlăturată pentru el.',
                arch_report_lidar_near_long: 'Cel mai apropiat obiect LIDAR Scanner („{title}”) este la {dist}, deci componenta este punctată proporțional cu această proximitate.',
                arch_report_lidar_none_long: 'Niciun obiect LIDAR Scanner nu este aproape de acest punct, deci componenta revine la valoarea de bază.',
                arch_report_uat_line_title: 'Verificare UAT',
                arch_report_uat_ok_long: 'Punctul se află pe zona roșie a stratului UAT (în afara zonei construite), iar cel mai apropiat pixel non-roșu — adică UAT-ul — este la {dist}, ceea ce satisface distanțarea obligatorie de 500 m.',
                arch_report_period_title: 'Perioadă estimată',
                arch_report_period_line: 'Cea mai probabilă perioadă: {period} (acord {confidence}%).',
                arch_report_period_explain: 'Estimarea este un vot ponderat cu inversul distanței peste datarea înregistrată pentru cele mai apropiate situri cunoscute — o triangulare în timp, în oglindă cu triangularea spațială care a produs zonele cu potențial. Este o indicație, nu un diagnostic; siturile care au stat la baza ei sunt listate mai jos.',
                arch_report_period_none: 'Cele mai apropiate situri cunoscute nu au o datare utilizabilă, deci nu poate fi estimată nicio perioadă pentru acest punct.',
                arch_report_period_evidence: 'Situri folosite pentru estimare',
                arch_report_period_unknown: 'Nedeterminată',
                arch_report_sites_title: 'Cele mai apropiate situri cunoscute',
                arch_report_sites_note: 'Distanțele sunt măsurate până la geometria sitului; pentru siturile tip poligon, până la cel mai apropiat punct al conturului. Linkurile deschid fișa RAN / CIMEC.',
                arch_report_tbl_site: 'Sit',
                arch_report_tbl_period: 'Perioadă',
                arch_report_tbl_type: 'Tip',
                arch_report_tbl_dist: 'Distanță',
                arch_report_tbl_link: 'RAN / CIMEC',
                arch_report_tbl_result: 'Rezultat',
                arch_report_tbl_class: 'Clasificare',
                arch_report_tbl_coords: 'Coordonate',
                arch_report_figures_title: 'Imagini explicative',
                arch_report_fig_apm_title: 'Vederea APM 2.0 a zonei (opacitate 30%)',
                arch_report_fig_apm_caption: 'Rasterul APM 2.0 la 30% opacitate peste imaginea satelitară, exact cum se citește de obicei stratul. Pătratul portocaliu este aria analizată de 5 km²; poligoanele portocalii sunt rezultatele.',
                arch_report_fig_lidar_title: 'Vederea LIDAR a zonei',
                arch_report_fig_lidar_caption: 'Zona peste hillshade-ul LIDAR activ, cu adnotările LIDAR Scanner marcate cu verde. Această imagine este inclusă pentru că în zonă există cel puțin un obiect al scannerului.',
                arch_report_fig_potential_title: 'Zonele cu potențial față de siturile cunoscute',
                arch_report_fig_potential_caption: 'Cercurile mov sunt zonele cu potențial returnate de stratul de triangulare, desenate alături de siturile cunoscute (puncte violete, poligoane roșii). Imaginea este inclusă pentru că aria conține cel puțin o astfel de zonă.',
                arch_report_fig_potential_badge: 'Triangulare',
                arch_report_fig_satellite: 'Satelit',
                arch_report_fig_sources: 'Surse desenate: {list}',
                arch_report_fig_missing: 'Nedesenate (pixeli ilizibili / nefolosite): {list}',
                arch_report_sources_page_title: 'Surse, legendă și limite',
                arch_report_provenance_title: 'Proveniența datelor',
                arch_report_legend_title: 'Legenda hărții folosite în imagini',
                arch_report_legend_apm: 'APM 2.0: albastru = 5, verde = 4.5, galben = 4, kaki/maro = 3, roz = 2, roșu = 1. Doar albastru, verde și galben pot găzdui un rezultat.',
                arch_report_legend_results: 'Pătrat portocaliu punctat = aria analizată de 5 km². Poligoane portocalii = rezultatele returnate, etichetate Rezultat 1/2/3.',
                arch_report_legend_potential: 'Cercuri mov = zonele cu potențial din stratul de triangulare. Puncte violete = situri punct cunoscute, poligoane roșii = contururi de situri cunoscute (RAN / CIMEC).',
                arch_report_disclaimer_title: 'Limite și precizare legală',
                arch_report_disclaimer_full: 'Scorurile sunt statistice, nu predictive: descriu cât de mult seamănă o locație cu locurile în care există deja situri cunoscute și cât de bine se potrivește modelului APM 2.0. Absența unui rezultat nu înseamnă absența arheologiei, iar un scor mare nu garantează o descoperire. Activitatea pe teren în România este reglementată: periegheza cu detectorul de metale necesită autorizațiile prevăzute de lege, iar orice descoperire arheologică trebuie declarată. DetectLab nu își asumă nicio responsabilitate pentru utilizarea acestui document în afara cadrului legal.',
                arch_report_generated_by: 'Generat automat de DetectLab — js/archeo-report.js',
                arch_period_paleolithic: 'Paleolitic',
                arch_period_mesolithic: 'Mezolitic',
                arch_period_neolithic: 'Neolitic',
                arch_period_eneolithic: 'Eneolitic (Calcolitic)',
                arch_period_bronze_age: 'Epoca Bronzului',
                arch_period_hallstatt: 'Hallstatt (prima epocă a fierului)',
                arch_period_iron_age: 'Epoca Fierului',
                arch_period_dacian: 'Dacic / Geto-dacic',
                arch_period_roman: 'Roman',
                arch_period_migration: 'Epoca migrațiilor',
                arch_period_medieval: 'Medieval',
                arch_period_modern: 'Modern',
                arch_period_prehistoric: 'Preistorie (generic)',
                arch_period_antiquity: 'Antichitate (generic)',
                iosfree_hint: 'Caută sau zoom pe o localitate',
                iosfree_loading: 'Se încarcă imaginea…',
                iosfree_notfound: 'Nu s-a găsit hartă pentru această localitate',
                iosfree_zoom: 'Zoom ≥ 13 sau caută o localitate pentru a activa',
                iosfree_search_btn: 'Caută aici',
                hist_zoom_hint: 'Zoom in ca să vezi harta',
                apm20_search_help: 'Ajutor de căutare',
                apm20_search_help_loading: 'Se analizează zona vizibilă…',
                apm20_search_help_empty: 'Nu s-au găsit zone clare cu potențial ridicat în zona vizibilă',
                apm20_search_help_error: 'Nu am putut analiza zona vizibilă, încearcă din nou',
                apm20_search_help_zoom: 'Mărește zoom-ul pentru a folosi Ajutor de căutare',
                apm20_search_help_hint: 'Mărește zoom-ul pentru căutare avansată',
                ios_bld_search_help: 'Clădiri Dispărute',
                ios_bld_search_help_loading: 'Se analizează Harta Iosefină +…',
                ios_bld_search_help_empty: 'Nu s-au găsit clădiri dispărute în zona vizibilă',
                ios_bld_search_help_error: 'Activează mai întâi stratul Harta Iosefină +',
                ios_bld_search_help_hint: 'Zoom in mai mult',
                ios_bld_search_help_zoom: 'Zoom in mai mult',
                ios_bld_search_help_zoom_in: 'Zoom in mai mult',
                ios_bld_search_help_zoom_out: 'Zoom out mai mult',
            }
        };

        const LANGUAGE_STORAGE_KEY = 'detectlab_lang';

        function getStoredLanguage() {
            try {
                var stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
                return translations[stored] ? stored : 'ro';
            } catch (e) {
                // Storage can be unavailable in private/restricted WebViews.
                return 'ro';
            }
        }

        let currentLang = getStoredLanguage();

        function toggleLangDropdown() {
            var dd = document.getElementById('langDropdown');
            if (dd) dd.classList.toggle('open');
        }

        function pickLang(lang) {
            setLang(lang);
            var dropdown = document.getElementById('langDropdown');
            if (dropdown) dropdown.classList.remove('open');
        }

        function syncLanguageSelectors(lang) {
            var flagMap = { en: '🇬🇧', ro: '🇷🇴' };
            var code = lang.toUpperCase();
            var flag = document.getElementById('langFlag');
            var desktopCode = document.getElementById('langCode');
            var desktopEn = document.getElementById('langOptEn');
            var desktopRo = document.getElementById('langOptRo');
            var pwaCode = document.getElementById('pwaLangCode');
            var pwaFlag = document.getElementById('pwaLangFlag');
            var pwaEn = document.getElementById('pwaLangOptEn');
            var pwaRo = document.getElementById('pwaLangOptRo');

            if (flag) flag.textContent = flagMap[lang];
            if (desktopCode) desktopCode.textContent = code;
            if (desktopEn) desktopEn.classList.toggle('selected', lang === 'en');
            if (desktopRo) desktopRo.classList.toggle('selected', lang === 'ro');
            if (pwaCode) pwaCode.textContent = code;
            if (pwaFlag) pwaFlag.style.display = 'none';
            if (pwaEn) pwaEn.classList.toggle('selected', lang === 'en');
            if (pwaRo) pwaRo.classList.toggle('selected', lang === 'ro');
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            var dd = document.getElementById('langDropdown');
            if (dd && !dd.contains(e.target)) dd.classList.remove('open');
        });

        // ── BILLING TOGGLE ──
        // Only the monthly plan is sold: weekly & yearly are marked as
        // "Not available" in the pricing section, so the toggle is locked
        // on monthly billing.
        // €5 is a ONE-TIME payment granting Premium for one calendar month
        // (no automatic renewal), so the period reads "/one month" rather
        // than the old recurring "/month".
        let isMonthly = true;
        const prices = {
            monthly: { bronze: ['—', ''], silver: ['5', '/one month'], gold: ['—', ''] }
        };
        const periodRO = { '/week': '/săpt.', '/month': '/lună', '/one month': '/o lună', '/year': '/an' };

        function setLang(lang) {
            if (!translations[lang]) lang = 'ro';
            currentLang = lang;

            try {
                localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
            } catch (e) {
                // Keep the in-memory choice even when storage is unavailable.
            }

            document.documentElement.lang = lang;
            const T = translations[lang];
            document.querySelectorAll('.t[data-key]').forEach(el => {
                const key = el.getAttribute('data-key');
                if (T[key] !== undefined) el.innerHTML = T[key];
            });
            // The SEO guide has one indexable URL per language. Keep every
            // website-only navigation entry pointed at the matching version.
            document.querySelectorAll('[data-useful-info-link]').forEach(el => {
                el.href = lang === 'en' ? 'useful-information.html' : 'informatii-utile.html';
                el.hreflang = lang;
            });
            syncLanguageSelectors(lang);
            updateBillingDisplay();
        }

        // Expose the canonical language state to PWA controls and map widgets.
        // A top-level `let` is not available as window.currentLang, which was
        // why the PWA polling fallback repeatedly reset the selector to RO.
        window._currentLang = function () { return currentLang; };
        window.pickLang = pickLang;
        window.setLang = setLang;

        // Restore the user's previous choice instead of forcing Romanian on
        // every load/relaunch of the installed app.
        setLang(currentLang);

        function toggleBilling() {
            // Only monthly billing is offered; keep the toggle inert.
            isMonthly = true;
            updateBillingDisplay();
        }

        function updateBillingDisplay() {
            const mode = isMonthly ? 'monthly' : 'weekly';
            const T = translations[currentLang];
            const pricesForMode = prices[mode] || prices.monthly;
            ['bronze', 'silver', 'gold'].forEach(tier => {
                const row = pricesForMode[tier] || ['—', ''];
                const price = row[0];
                const period = row[1];
                // Guarded so translations.js can also load on pages that
                // don't contain the pricing section (e.g. checkout.html).
                const priceEl = document.getElementById(tier + 'Price');
                if (priceEl) priceEl.textContent = price;
                const pEl = document.getElementById(tier + 'Period');
                if (pEl) pEl.textContent = currentLang === 'ro' ? (periodRO[period] || period) : period;
                const nKey = tier === 'gold' ? 'note_yearly' : (tier === 'silver' ? 'note_monthly' : 'note_weekly');
                const nEl = document.getElementById(tier + 'Note');
                if (nEl) nEl.innerHTML = T[nKey] || '';
            });
        }

        // ── HARTA IOSEFINĂ OVERLAY ──
        function openIosfreeModal(imgUrl, locality) {
            var modal = document.getElementById('iosfreeModal');
            var img   = document.getElementById('iosfreeModalImg');
            if (!modal || !img) return;
            img.src = imgUrl;
            img.alt = locality;
            // Apply current slider opacity
            var slider = document.getElementById('iosfreeOpacitySlider');
            if (slider) img.style.opacity = slider.value / 100;
            modal.classList.add('visible');
            document.addEventListener('keydown', _iosfreeEscHandler);
        }
        function closeIosfreeModal() {
            var modal = document.getElementById('iosfreeModal');
            if (modal) modal.classList.remove('visible');
            document.removeEventListener('keydown', _iosfreeEscHandler);
        }
        function _iosfreeEscHandler(e) {
            if (e.key === 'Escape') closeIosfreeModal();
        }
        function iosfreeMapPan(dfracX, dfracY) {
            // dfracX, dfracY: fracțiuni din dimensiunea geografică a imaginii
            // ex: 0.12 înseamnă "mișcă cu 12% din lățimea/înălțimea hărții"
            var overlay = window._iosfreeCurrentOverlay;
            var map     = window._dlMap;
            if (!overlay || !map) return;

            var initBounds = overlay._initialBounds || overlay._bounds;
            var imgLat = initBounds.getNorth() - initBounds.getSouth(); // grade latitudine
            var imgLng = initBounds.getEast()  - initBounds.getWest(); // grade longitudine

            // Offset curent față de centrul inițial (grade)
            var initCenter = initBounds.getCenter();
            var curCenter  = overlay._bounds.getCenter();
            var curOffLng  = curCenter.lng - initCenter.lng;
            var curOffLat  = curCenter.lat - initCenter.lat;

            // Delta geografic propus
            var dLng = dfracX * imgLng;
            var dLat = dfracY * imgLat; // pozitiv = spre Nord

            // Limite: dreptunghiul e 3× imaginea → offset max = 1× dimensiunea imaginii
            var maxOffLng = imgLng;
            var maxOffLat = imgLat;

            var newOffLng = Math.max(-maxOffLng, Math.min(maxOffLng, curOffLng + dLng));
            var newOffLat = Math.max(-maxOffLat, Math.min(maxOffLat, curOffLat + dLat));

            var actualDLng = newOffLng - curOffLng;
            var actualDLat = newOffLat - curOffLat;
            if (Math.abs(actualDLng) < 1e-9 && Math.abs(actualDLat) < 1e-9) return;

            var b = overlay._bounds;
            var newBounds = L.latLngBounds(
                [b.getSouth() + actualDLat, b.getWest() + actualDLng],
                [b.getNorth() + actualDLat, b.getEast() + actualDLng]
            );
            overlay.setBounds(newBounds);
            window._iosfreeCurrentBounds = newBounds;
        }

        // ── MAP TABS ──
        function switchTab(el, type) {
            document.querySelectorAll('.map-tab').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
            document.getElementById('mapLock').classList.toggle('show', type === 'member');

            // Weather tab toggle
            var weatherPanel = document.getElementById('weatherPanel');
            var mapWrapper = document.querySelector('.map-wrapper');
            var mapLegend = document.querySelector('.map-legend-bar');
            var mapControls = document.querySelector('.map-controls');
            var transpTab = document.getElementById('transpTab');
            var transpPanel = document.getElementById('transpPanel');
            var mapSearch = document.getElementById('mapSearchWrap');

            if (type === 'weather') {
                weatherPanel.classList.add('active');
                if (mapWrapper) mapWrapper.style.display = 'none';
                var mapFrame = document.querySelector('.map-frame');
                if (mapFrame) mapFrame.style.display = 'none';
                if (mapLegend) mapLegend.style.display = 'none';
                if (mapControls) mapControls.style.display = 'none';
                if (transpTab) transpTab.style.display = 'none';
                if (transpPanel) transpPanel.style.display = 'none';
                if (mapSearch) mapSearch.style.display = 'none';
            } else {
                weatherPanel.classList.remove('active');
                if (mapWrapper) mapWrapper.style.display = '';
                var mapFrame = document.querySelector('.map-frame');
                if (mapFrame) mapFrame.style.display = '';
                if (mapLegend) mapLegend.style.display = '';
                if (mapControls) mapControls.style.display = '';
                if (transpTab) transpTab.style.display = '';
                if (transpPanel) transpPanel.style.display = '';
                if (mapSearch) mapSearch.style.display = '';
            }
        }

        // ── WEATHER FEATURE ──
        (function () {
            var _suggestTimer = null;
            var _selectedLat = null, _selectedLon = null, _selectedName = null;

            var WMO_CODES = {
                0: ['☀️', 'Cer senin'],
                1: ['🌤', 'Predominant senin'],
                2: ['⛅', 'Parțial noros'],
                3: ['☁️', 'Noros'],
                45: ['🌫', 'Ceață'],
                48: ['🌫', 'Ceață cu chiciură'],
                51: ['🌦', 'Burniță ușoară'],
                53: ['🌦', 'Burniță moderată'],
                55: ['🌧', 'Burniță densă'],
                61: ['🌧', 'Ploaie ușoară'],
                63: ['🌧', 'Ploaie moderată'],
                65: ['🌧', 'Ploaie abundentă'],
                71: ['🌨', 'Ninsoare ușoară'],
                73: ['🌨', 'Ninsoare moderată'],
                75: ['❄️', 'Ninsoare abundentă'],
                77: ['🌨', 'Fulgi de nea'],
                80: ['🌦', 'Averse ușoare'],
                81: ['🌧', 'Averse moderate'],
                82: ['⛈', 'Averse puternice'],
                85: ['🌨', 'Ninsoare cu averse'],
                86: ['❄️', 'Ninsoare cu averse intense'],
                95: ['⛈', 'Furtună'],
                96: ['⛈', 'Furtună cu grindină'],
                99: ['⛈', 'Furtună cu grindină mare'],
            };

            function wmoInfo(code) {
                return WMO_CODES[code] || ['🌡', 'Condiții variate'];
            }

            var DAYS_RO = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];

            window.onWeatherInput = function (val) {
                clearTimeout(_suggestTimer);
                var list = document.getElementById('weatherSuggestList');
                if (val.trim().length < 2) { list.classList.add('hidden'); return; }
                _suggestTimer = setTimeout(function () { fetchSuggestions(val.trim()); }, 280);
            };

            window.onWeatherKey = function (e) {
                if (e.key === 'Enter') { searchWeather(); }
            };

            function fetchSuggestions(q) {
                var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) +
                    '&count=6&language=ro&countryCode=RO';
                fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                    var list = document.getElementById('weatherSuggestList');
                    if (!data.results || !data.results.length) { list.classList.add('hidden'); return; }
                    list.innerHTML = '';
                    data.results.forEach(function (loc) {
                        var li = document.createElement('li');
                        li.textContent = loc.name + (loc.admin1 ? ', ' + loc.admin1 : '');
                        li.addEventListener('click', function () {
                            document.getElementById('weatherInput').value = li.textContent;
                            list.classList.add('hidden');
                            _selectedLat = loc.latitude;
                            _selectedLon = loc.longitude;
                            _selectedName = loc.name + (loc.admin1 ? ', ' + loc.admin1 : '');
                            loadWeather(_selectedLat, _selectedLon, _selectedName);
                        });
                        list.appendChild(li);
                    });
                    list.classList.remove('hidden');
                }).catch(function () { });
            }

            window.searchWeather = function () {
                var input = document.getElementById('weatherInput').value.trim();
                document.getElementById('weatherSuggestList').classList.add('hidden');
                if (!input) return;
                if (_selectedName && input === _selectedName && _selectedLat) {
                    loadWeather(_selectedLat, _selectedLon, _selectedName);
                    return;
                }
                // Geocode first
                var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(input) +
                    '&count=1&language=ro&countryCode=RO';
                showWeatherLoading();
                fetch(url).then(function (r) { return r.json(); }).then(function (data) {
                    if (!data.results || !data.results.length) {
                        showWeatherError('Localitatea "' + input + '" nu a fost găsită în România.');
                        return;
                    }
                    var loc = data.results[0];
                    _selectedLat = loc.latitude;
                    _selectedLon = loc.longitude;
                    _selectedName = loc.name + (loc.admin1 ? ', ' + loc.admin1 : '');
                    loadWeather(_selectedLat, _selectedLon, _selectedName);
                }).catch(function () {
                    showWeatherError('Eroare la geocodare. Verifică conexiunea la internet.');
                });
            };

            function loadWeather(lat, lon, name) {
                showWeatherLoading();
                var url = 'https://api.open-meteo.com/v1/forecast' +
                    '?latitude=' + lat + '&longitude=' + lon +
                    '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,sunrise,sunset' +
                    '&hourly=relativehumidity_2m,windspeed_10m' +
                    '&current_weather=true' +
                    '&timezone=auto' +
                    '&forecast_days=6';
                fetch(url).then(function (r) { return r.json(); }).then(function (d) {
                    renderWeather(d, name);
                }).catch(function () {
                    showWeatherError('Eroare la încărcarea datelor meteo.');
                });
            }

            function renderWeather(d, name) {
                var cw = d.current_weather;
                var daily = d.daily;

                document.getElementById('wCityName').textContent = name;
                var latStr = _selectedLat ? _selectedLat.toFixed(3) + '°N, ' + _selectedLon.toFixed(3) + '°E' : '';
                document.getElementById('wCityMeta').textContent = latStr;

                // Today (index 0)
                var todayCode = daily.weathercode[0];
                var todayInfo = wmoInfo(todayCode);
                document.getElementById('wTodayIcon').textContent = todayInfo[0];
                document.getElementById('wTodayTemp').textContent = Math.round(cw.temperature) + '°C';
                document.getElementById('wTodayFeels').textContent =
                    'Max ' + Math.round(daily.temperature_2m_max[0]) + '° / Min ' + Math.round(daily.temperature_2m_min[0]) + '°';
                document.getElementById('wTodayDesc').textContent = todayInfo[1];

                // Details chips
                var detailsEl = document.getElementById('wTodayDetails');
                detailsEl.innerHTML =
                    chip('💨', 'Vânt', Math.round(cw.windspeed) + ' km/h') +
                    chip('🌧', 'Precipitații', (daily.precipitation_sum[0] || 0).toFixed(1) + ' mm') +
                    chip('🌅', 'Răsărit', fmtTime(daily.sunrise[0])) +
                    chip('🌇', 'Apus', fmtTime(daily.sunset[0]));

                // 5-day (index 1–5)
                var fiveDayEl = document.getElementById('w5Day');
                fiveDayEl.innerHTML = '';
                for (var i = 1; i <= 5; i++) {
                    var code = daily.weathercode[i];
                    var info = wmoInfo(code);
                    var date = new Date(daily.time[i] + 'T12:00:00');
                    var dayName = DAYS_RO[date.getDay()];
                    var rain = (daily.precipitation_sum[i] || 0).toFixed(1);
                    fiveDayEl.innerHTML +=
                        '<div class="weather-day-card">' +
                        '<div class="weather-day-name">' + dayName + '</div>' +
                        '<div class="weather-day-icon">' + info[0] + '</div>' +
                        '<div class="weather-day-max">' + Math.round(daily.temperature_2m_max[i]) + '°</div>' +
                        '<div class="weather-day-min">' + Math.round(daily.temperature_2m_min[i]) + '°</div>' +
                        '<div class="weather-day-rain">💧 ' + rain + ' mm</div>' +
                        '</div>';
                }

                document.getElementById('weatherLoading').classList.remove('show');
                document.getElementById('weatherError').classList.remove('show');
                document.getElementById('weatherResult').classList.add('show');
            }

            function chip(icon, label, val) {
                return '<div class="weather-detail-chip"><span>' + icon + ' ' + label + '</span><span>' + val + '</span></div>';
            }

            function fmtTime(isoStr) {
                if (!isoStr) return '—';
                var d = new Date(isoStr);
                return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
            }

            function showWeatherLoading() {
                document.getElementById('weatherLoading').classList.add('show');
                document.getElementById('weatherError').classList.remove('show');
                document.getElementById('weatherResult').classList.remove('show');
            }

            function showWeatherError(msg) {
                document.getElementById('weatherLoading').classList.remove('show');
                var el = document.getElementById('weatherError');
                el.textContent = '⚠️ ' + msg;
                el.classList.add('show');
                document.getElementById('weatherResult').classList.remove('show');
            }

            // Close suggestions when clicking outside
            document.addEventListener('click', function (e) {
                if (!e.target.closest('.weather-suggestions')) {
                    var list = document.getElementById('weatherSuggestList');
                    if (list) list.classList.add('hidden');
                }
            });
        })();

        // ── SCROLL REVEAL ──
        const observer = new IntersectionObserver(entries => {
            entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
        }, { threshold: 0.12 });

        document.querySelectorAll('.what-card, .step, .plan-card').forEach(el => observer.observe(el));
