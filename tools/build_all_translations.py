#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build all European translations into js/translations.js
"""
import json
import re

with open('tools/en.json', 'r', encoding='utf-8') as f:
    EN = json.load(f)

with open('tools/ro.json', 'r', encoding='utf-8') as f:
    RO = json.load(f)

# Clean any artifact keys
for d in [EN, RO]:
    if 'en' in d: del d['en']
    if 'ro' in d: del d['ro']

# Define dictionaries for all European languages
# We create rich, full language dictionaries for each European country
DE = dict(EN)
DE.update({
    'nav_apm': 'Was ist APM', 'nav_map': 'Karte erkunden', 'nav_how': 'Wie es funktioniert', 'nav_pricing': 'Preise', 'nav_useful': 'Nützliche Informationen', 'nav_cta': 'Zugang erhalten',
    'nav_tech': 'Technologie', 'nav_process': 'Prozess', 'nav_events': 'Ereignisse', 'nav_friends': 'Freunde', 'nav_logout': 'Abmelden', 'nav_login': 'Anmelden',
    'manage_account': 'Konto verwalten', 'menu_language': 'Sprache', 'menu_storage': 'Speicher',
    'hero_badge': 'Archäologie × Künstliche Intelligenz', 'hero_tagline': 'Gemeinsam Geschichte bewahren',
    'hero_btn1': '🗺 Karte erkunden', 'hero_btn2': 'Mitgliedschaftspläne anzeigen', 'scroll': 'Scrollen zum Entdecken',
    'what_label': 'Technologie', 'what_title': 'Was ist ein <span class="hl">Archäologisches Vorhersagemodell</span>?',
    'what_desc': 'Eine intelligente Karte, die die Landschaft wie ein Archäologe liest. Das APM analysiert Umweltdaten, um prähistorische und historische Siedlungsbereiche zu lokalisieren.',
    'tab_free': '🔓 Kostenlose Vorschau', 'tab_member': '🔐 Mitgliederkarte',
    'layer_opacity': 'Ebenentransparenz', 'layer_satellite': 'Satellit', 'layer_sat_period_label': 'Historisch', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM-Orte', 'layer_uat': 'Verwaltungsgrenzen (UAT)', 'layer_heritage': 'Kulturerbe', 'layer_heritage_group': 'Erbe & Kultur',
    'layer_historical': 'Historische Karten', 'layer_historical_premium': 'Historische Karten', 'layer_historical_eu': 'Europäische historische Karten (CENAGIS / IH PAN)',
    'layer_josephine': 'Josephinische Landesaufnahme +', 'layer_iosfree': 'Josephinische Landesaufnahme', 'layer_austrian': 'Österreichische Karte 1910',
    'layer_firing_plans': 'Schießpläne', 'layer_soviet': 'Sowjetische Karte 1970', 'layer_banat': 'Banat - 1769-1772',
    'layer_transylvania1859': 'Karte von Siebenbürgen 1859', 'layer_galicia1855': 'Administrativ-Karte von Galizien und Lodomerien – 1855',
    'layer_mitteleuropa': 'Übersichtskarte von Mitteleuropa 1:300.000 (1893–1945)', 'layer_chrzanowski': 'Wojciech Chrzanowski Karte (1859)',
    'layer_reymann': 'Reymanns Special-Karte von Central-Europa (1806–1908)', 'layer_kdr100k': 'Karte des Deutschen Reiches 1:100.000 (1878–1945)',
    'layer_kdr_gb': 'Karte des Deutschen Reiches – Großblatt (1914–1944)', 'layer_wig100k': 'Polnische Militärkarte – WIG 1:100.000 (1919–1939)',
    'layer_bucovina': 'Bukowina 1861-1864', 'layer_austrohu': 'Österreichisch-Ungarische Karte 1861-1864', 'layer_moldova1868': 'Moldau 1868',
    'layer_moldovawwii': 'Moldau II', 'layer_polishtactical1933': 'Polnische Taktische Karte 1933', 'layer_ww1': 'Erster Weltkrieg (WWI)', 'layer_ww2': 'Zweiter Weltkrieg (WWII)',
    'layer_moldova1771': 'Moldau 1771', 'layer_sat60': 'Satellitenbilder der 1960er Jahre (CORONA)',
    'layer_vegfp_group': 'Vegetations-Fingerabdruck', 'layer_vegfp_ppi': 'PPI (Pflanzenphänologie-Index)', 'layer_vegfp_smx': 'SMX (Saison-Höchstwert)',
    'layer_vegfp_sgu': 'SGU (Saison-Begrünungsrate)', 'layer_vegfp_sgd': 'SGD (Saison-Verwelkungsrate)',
    'layer_vegfp_date_label': 'Datum', 'layer_vegfp_year_label': 'Jahr', 'layer_vegfp_prev_dekad': 'Vorherige 10-Tage-Periode', 'layer_vegfp_next_dekad': 'Nächste 10-Tage-Periode',
    'layer_vegfp_prev_year': 'Vorheriges Jahr', 'layer_vegfp_next_year': 'Nächstes Jahr', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Höhenmodell (DTM)', 'layer_lidar_sub_dsm': 'Oberflächenmodell (DSM)', 'layer_lidar_sub_slope': 'Neigung',
    'layer_lidar_sub_aspect': 'Exposition (Aspect)', 'layer_lidar_sub_hillshade': 'Schattiertes Relief (Hillshade)', 'layer_lidar_sub_tri': 'Geländerauhigkeit (TRI)',
    'layer_lidar_sub_tpi': 'Topographische Position (TPI)', 'layer_lidar_sub_roughness': 'Rauigkeit', 'layer_lidar_sub_curv_profile': 'Profilkrümmung',
    'layer_lidar_sub_curv_plan': 'Plankrümmung', 'layer_lidar_sub_curv_general': 'Gesamtkrümmung',
    'layer_roman': 'Römisches Reich', 'layer_archeo_potential': 'Archäologische Potenzialzonen', 'layer_arch_report': 'Archäologischer Bericht', 'layer_battles': 'Schlachten',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Schalten Sie alle Premium-Ebenen auf der interaktiven Karte frei.',
    'prem_login_needed': 'Sie benötigen ein kostenloses Konto, um Premium zu erwerben.', 'prem_login_btn': 'Anmelden / Registrieren',
    'prem_already': 'Ihr Premium-Monat ist noch aktiv. Vielen Dank!', 'btn_bronze': 'Kaufen', 'btn_silver': 'Kaufen', 'btn_gold': 'Kaufen',
    'free_title': 'Kostenlos — Immer verfügbar', 'free_btn': 'Kostenlose Karte erkunden'
})

FR = dict(EN)
FR.update({
    'nav_apm': 'Qu\'est-ce que l\'APM', 'nav_map': 'Explorer la carte', 'nav_how': 'Comment ça marche', 'nav_pricing': 'Tarifs', 'nav_useful': 'Informations utiles', 'nav_cta': 'Obtenir l\'accès',
    'nav_tech': 'Technologie', 'nav_process': 'Processus', 'nav_events': 'Événements', 'nav_friends': 'Amis', 'nav_logout': 'Déconnexion', 'nav_login': 'Connexion',
    'manage_account': 'Gérer le compte', 'menu_language': 'Langue', 'menu_storage': 'Stockage',
    'hero_badge': 'Archéologie × Intelligence Artificielle', 'hero_tagline': 'Sauvegarder l\'histoire ensemble',
    'hero_btn1': '🗺 Explorer la carte', 'hero_btn2': 'Voir les abonnements', 'scroll': 'Faire défiler pour découvrir',
    'what_label': 'Technologie', 'what_title': 'Qu\'est-ce qu\'un <span class="hl">Modèle de Prédiction Archéologique</span>?',
    'tab_free': '🔓 Aperçu gratuit', 'tab_member': '🔐 Carte abonnés',
    'layer_opacity': 'Opacité de la couche', 'layer_satellite': 'Satellite', 'layer_sat_period_label': 'Historique', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'Lieux OSM', 'layer_uat': 'Limites administratives (UAT)', 'layer_heritage': 'Patrimoine', 'layer_heritage_group': 'Patrimoine & Culture',
    'layer_historical': 'Cartes historiques', 'layer_historical_premium': 'Cartes historiques', 'layer_historical_eu': 'Cartes historiques européennes (CENAGIS / IH PAN)',
    'layer_josephine': 'Carte Joséphine +', 'layer_iosfree': 'Carte Joséphine', 'layer_austrian': 'Carte autrichienne 1910',
    'layer_firing_plans': 'Plans de tir', 'layer_soviet': 'Carte soviétique 1970', 'layer_banat': 'Banat - 1769-1772',
    'layer_transylvania1859': 'Carte de Transylvanie 1859', 'layer_galicia1855': 'Carte administrative de Galicie et Lodomérie – 1855',
    'layer_mitteleuropa': 'Carte générale d\'Europe centrale 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Carte Wojciech Chrzanowski (1859)',
    'layer_reymann': 'Carte spéciale d\'Europe centrale – Reymann (1806–1908)', 'layer_kdr100k': 'Carte de l\'Empire allemand 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Carte de l\'Empire allemand – Großblatt (1914–1944)', 'layer_wig100k': 'Carte militaire polonaise – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Bucovine 1861-1864', 'layer_austrohu': 'Carte austro-hongroise 1861-1864', 'layer_moldova1868': 'Moldavie 1868',
    'layer_moldovawwii': 'Moldavie II', 'layer_polishtactical1933': 'Carte tactique polonaise 1933', 'layer_ww1': 'Première Guerre mondiale', 'layer_ww2': 'Seconde Guerre mondiale',
    'layer_moldova1771': 'Moldavie 1771', 'layer_sat60': 'Imagerie satellite des années 1960 (CORONA)',
    'layer_vegfp_group': 'Empreinte de la végétation', 'layer_vegfp_ppi': 'PPI (Indice phénologique végétal)', 'layer_vegfp_smx': 'SMX (Valeur maximale saisonnière)',
    'layer_vegfp_sgu': 'SGU (Taux de verdissement saisonnier)', 'layer_vegfp_sgd': 'SGD (Taux de flétrissement saisonnier)',
    'layer_vegfp_date_label': 'Date', 'layer_vegfp_year_label': 'Année', 'layer_vegfp_prev_dekad': 'Décade précédente', 'layer_vegfp_next_dekad': 'Décade suivante',
    'layer_vegfp_prev_year': 'Année précédente', 'layer_vegfp_next_year': 'Année suivante', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Élévation (MNT)', 'layer_lidar_sub_dsm': 'Surface (MNS)', 'layer_lidar_sub_slope': 'Pente',
    'layer_lidar_sub_aspect': 'Exposition', 'layer_lidar_sub_hillshade': 'Ombrage du relief', 'layer_lidar_sub_tri': 'Rugosité du terrain (TRI)',
    'layer_lidar_sub_tpi': 'Position topographique (TPI)', 'layer_lidar_sub_roughness': 'Rugosité', 'layer_lidar_sub_curv_profile': 'Courbure de profil',
    'layer_lidar_sub_curv_plan': 'Courbure de plan', 'layer_lidar_sub_curv_general': 'Courbure générale',
    'layer_roman': 'Empire Romain', 'layer_archeo_potential': 'Zones à potentiel archéologique', 'layer_arch_report': 'Rapport archéologique', 'layer_battles': 'Batailles',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Débloquez toutes les couches premium sur la carte interactive.',
    'prem_login_needed': 'Vous avez besoin d\'un compte gratuit pour acheter Premium.', 'prem_login_btn': 'Se connecter / S\'inscrire',
    'prem_already': 'Votre mois Premium est toujours actif. Merci!', 'btn_bronze': 'Acheter', 'btn_silver': 'Acheter', 'btn_gold': 'Acheter',
    'free_title': 'Gratuit — Toujours disponible', 'free_btn': 'Explorer la carte gratuite'
})

IT = dict(EN)
IT.update({
    'nav_apm': 'Cos\'è l\'APM', 'nav_map': 'Esplora la mappa', 'nav_how': 'Come funziona', 'nav_pricing': 'Prezzi', 'nav_useful': 'Informazioni utili', 'nav_cta': 'Ottieni accesso',
    'nav_tech': 'Tecnologia', 'nav_process': 'Processo', 'nav_events': 'Eventi', 'nav_friends': 'Amici', 'nav_logout': 'Disconnetti', 'nav_login': 'Accedi',
    'manage_account': 'Gestisci account', 'menu_language': 'Lingua', 'menu_storage': 'Archiviazione',
    'hero_badge': 'Archeologia × Intelligenza Artificiale', 'hero_tagline': 'Salviamo la storia insieme',
    'hero_btn1': '🗺 Esplora la mappa', 'hero_btn2': 'Vedi piani di abbonamento', 'scroll': 'Scorri per scoprire',
    'what_label': 'Tecnologia', 'what_title': 'Cos\'è un <span class="hl">Modello di Previsione Archeologica</span>?',
    'tab_free': '🔓 Anteprima gratuita', 'tab_member': '🔐 Mappa membri',
    'layer_opacity': 'Opacità livello', 'layer_satellite': 'Satellite', 'layer_sat_period_label': 'Storico', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'Località OSM', 'layer_uat': 'Confini amministrativi (UAT)', 'layer_heritage': 'Patrimonio', 'layer_heritage_group': 'Patrimonio & Cultura',
    'layer_historical': 'Mappe storiche', 'layer_historical_premium': 'Mappe storiche', 'layer_historical_eu': 'Mappe storiche europee (CENAGIS / IH PAN)',
    'layer_josephine': 'Mappa Giuseppina +', 'layer_iosfree': 'Mappa Giuseppina', 'layer_austrian': 'Mappa austriaca 1910',
    'layer_firing_plans': 'Piani di tiro', 'layer_soviet': 'Mappa sovietica 1970', 'layer_banat': 'Banato - 1769-1772',
    'layer_transylvania1859': 'Mappa della Transilvania 1859', 'layer_galicia1855': 'Mappa amministrativa di Galizia e Lodomiria – 1855',
    'layer_mitteleuropa': 'Mappa dell\'Europa centrale 1:300.000 (1893–1945)', 'layer_chrzanowski': 'Mappa Wojciech Chrzanowski (1859)',
    'layer_reymann': 'Mappa speciale dell\'Europa centrale – Reymann (1806–1908)', 'layer_kdr100k': 'Mappa dell\'Impero tedesco 1:100.000 (1878–1945)',
    'layer_kdr_gb': 'Mappa dell\'Impero tedesco – Großblatt (1914–1944)', 'layer_wig100k': 'Mappa militare polacca – WIG 1:100.000 (1919–1939)',
    'layer_bucovina': 'Bucovina 1861-1864', 'layer_austrohu': 'Mappa austro-ungarica 1861-1864', 'layer_moldova1868': 'Moldavia 1868',
    'layer_moldovawwii': 'Moldavia II', 'layer_polishtactical1933': 'Mappa tattica polacca 1933', 'layer_ww1': 'Prima guerra mondiale', 'layer_ww2': 'Seconda guerra mondiale',
    'layer_moldova1771': 'Moldavia 1771', 'layer_sat60': 'Immagini satellitari anni \'60 (CORONA)',
    'layer_vegfp_group': 'Impronta della vegetazione', 'layer_vegfp_ppi': 'PPI (Indice fenologico vegetale)', 'layer_vegfp_smx': 'SMX (Valore massimo stagionale)',
    'layer_vegfp_sgu': 'SGU (Tasso di inverdimento stagionale)', 'layer_vegfp_sgd': 'SGD (Tasso di appassimento stagionale)',
    'layer_vegfp_date_label': 'Data', 'layer_vegfp_year_label': 'Anno', 'layer_vegfp_prev_dekad': 'Decade precedente', 'layer_vegfp_next_dekad': 'Decade successiva',
    'layer_vegfp_prev_year': 'Anno precedente', 'layer_vegfp_next_year': 'Anno successivo', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Elevazione (DTM)', 'layer_lidar_sub_dsm': 'Superficie (DSM)', 'layer_lidar_sub_slope': 'Pendenza',
    'layer_lidar_sub_aspect': 'Esposizione', 'layer_lidar_sub_hillshade': 'Rilievo ombreggiato', 'layer_lidar_sub_tri': 'Rugosità del terreno (TRI)',
    'layer_lidar_sub_tpi': 'Posizione topografica (TPI)', 'layer_lidar_sub_roughness': 'Rugosità', 'layer_lidar_sub_curv_profile': 'Curvatura di profilo',
    'layer_lidar_sub_curv_plan': 'Curvatura di piano', 'layer_lidar_sub_curv_general': 'Curvatura generale',
    'layer_roman': 'Impero Romano', 'layer_archeo_potential': 'Aree a potenziale archeologico', 'layer_arch_report': 'Rapporto archeologico', 'layer_battles': 'Battaglie',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Sblocca tutti i livelli premium sulla mappa interattiva.',
    'prem_login_needed': 'È necessario un account gratuito per acquistare Premium.', 'prem_login_btn': 'Accedi / Registrati',
    'prem_already': 'Il tuo mese Premium è ancora attivo. Grazie!', 'btn_bronze': 'Acquista', 'btn_silver': 'Acquista', 'btn_gold': 'Acquista',
    'free_title': 'Gratuito — Sempre disponibile', 'free_btn': 'Esplora la mappa gratuita'
})

ES = dict(EN)
ES.update({
    'nav_apm': 'Qué es el APM', 'nav_map': 'Explorar el mapa', 'nav_how': 'Cómo funciona', 'nav_pricing': 'Precios', 'nav_useful': 'Información útil', 'nav_cta': 'Obtener acceso',
    'nav_tech': 'Tecnología', 'nav_process': 'Proceso', 'nav_events': 'Eventos', 'nav_friends': 'Amigos', 'nav_logout': 'Cerrar sesión', 'nav_login': 'Iniciar sesión',
    'manage_account': 'Gestionar cuenta', 'menu_language': 'Idioma', 'menu_storage': 'Almacenamiento',
    'hero_badge': 'Arqueología × Inteligencia Artificial', 'hero_tagline': 'Salvando la historia juntos',
    'hero_btn1': '🗺 Explorar el mapa', 'hero_btn2': 'Ver planes de membresía', 'scroll': 'Desplazarse para descubrir',
    'what_label': 'Tecnología', 'what_title': '¿Qué es un <span class="hl">Modelo de Predicción Arqueológica</span>?',
    'tab_free': '🔓 Vista previa gratuita', 'tab_member': '🔐 Mapa de miembros',
    'layer_opacity': 'Opacidad de la capa', 'layer_satellite': 'Satélite', 'layer_sat_period_label': 'Histórico', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'Lugares OSM', 'layer_uat': 'Límites administrativos (UAT)', 'layer_heritage': 'Patrimonio', 'layer_heritage_group': 'Patrimonio & Cultura',
    'layer_historical': 'Mapas históricos', 'layer_historical_premium': 'Mapas históricos', 'layer_historical_eu': 'Mapas históricos europeos (CENAGIS / IH PAN)',
    'layer_josephine': 'Mapa Josefino +', 'layer_iosfree': 'Mapa Josefino', 'layer_austrian': 'Mapa austríaco 1910',
    'layer_firing_plans': 'Planes de tiro', 'layer_soviet': 'Mapa soviético 1970', 'layer_banat': 'Banato - 1769-1772',
    'layer_transylvania1859': 'Mapa de Transilvania 1859', 'layer_galicia1855': 'Mapa administrativo de Galitzia y Lodomeria – 1855',
    'layer_mitteleuropa': 'Mapa general de Centroeuropa 1:300.000 (1893–1945)', 'layer_chrzanowski': 'Mapa Wojciech Chrzanowski (1859)',
    'layer_reymann': 'Mapa especial de Centroeuropa – Reymann (1806–1908)', 'layer_kdr100k': 'Mapa del Imperio alemán 1:100.000 (1878–1945)',
    'layer_kdr_gb': 'Mapa del Imperio alemán – Großblatt (1914–1944)', 'layer_wig100k': 'Mapa militar polaco – WIG 1:100.000 (1919–1939)',
    'layer_bucovina': 'Bucovina 1861-1864', 'layer_austrohu': 'Mapa austrohúngaro 1861-1864', 'layer_moldova1868': 'Moldavia 1868',
    'layer_moldovawwii': 'Moldavia II', 'layer_polishtactical1933': 'Mapa táctico polaco 1933', 'layer_ww1': 'Primera Guerra Mundial', 'layer_ww2': 'Segunda Guerra Mundial',
    'layer_moldova1771': 'Moldavia 1771', 'layer_sat60': 'Imágenes satelitales de los años 60 (CORONA)',
    'layer_vegfp_group': 'Huella de la vegetación', 'layer_vegfp_ppi': 'PPI (Índice fenológico vegetal)', 'layer_vegfp_smx': 'SMX (Valor máximo estacional)',
    'layer_vegfp_sgu': 'SGU (Tasa de reverdecimiento estacional)', 'layer_vegfp_sgd': 'SGD (Tasa de marchitamiento estacional)',
    'layer_vegfp_date_label': 'Fecha', 'layer_vegfp_year_label': 'Año', 'layer_vegfp_prev_dekad': 'Década anterior', 'layer_vegfp_next_dekad': 'Década siguiente',
    'layer_vegfp_prev_year': 'Año anterior', 'layer_vegfp_next_year': 'Año siguiente', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Elevación (MDT)', 'layer_lidar_sub_dsm': 'Superficie (MDS)', 'layer_lidar_sub_slope': 'Pendiente',
    'layer_lidar_sub_aspect': 'Orientación (Aspect)', 'layer_lidar_sub_hillshade': 'Relieve sombreado', 'layer_lidar_sub_tri': 'Rugosidad del terreno (TRI)',
    'layer_lidar_sub_tpi': 'Posición topográfica (TPI)', 'layer_lidar_sub_roughness': 'Rugosidad', 'layer_lidar_sub_curv_profile': 'Curvatura de perfil',
    'layer_lidar_sub_curv_plan': 'Curvatura de plano', 'layer_lidar_sub_curv_general': 'Curvatura general',
    'layer_roman': 'Imperio Romano', 'layer_archeo_potential': 'Zonas con potencial arqueológico', 'layer_arch_report': 'Informe arqueológico', 'layer_battles': 'Batallas',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Desbloquea todas las capas premium en el mapa interactivo.',
    'prem_login_needed': 'Necesitas una cuenta gratuita para comprar Premium.', 'prem_login_btn': 'Iniciar sesión / Registrarse',
    'prem_already': 'Tu mes Premium sigue activo. ¡Gracias!', 'btn_bronze': 'Comprar', 'btn_silver': 'Comprar', 'btn_gold': 'Comprar',
    'free_title': 'Gratuito — Siempre disponible', 'free_btn': 'Explorar mapa gratuito'
})

PL = dict(EN)
PL.update({
    'nav_apm': 'Czym jest APM', 'nav_map': 'Przeglądaj mapę', 'nav_how': 'Jak to działa', 'nav_pricing': 'Cennik', 'nav_useful': 'Przydatne informacje', 'nav_cta': 'Uzyskaj dostęp',
    'nav_tech': 'Technologia', 'nav_process': 'Proces', 'nav_events': 'Wydarzenia', 'nav_friends': 'Znajomi', 'nav_logout': 'Wyloguj', 'nav_login': 'Zaloguj',
    'manage_account': 'Zarządzaj kontem', 'menu_language': 'Język', 'menu_storage': 'Pamięć',
    'hero_badge': 'Archeologia × Sztuczna Inteligencja', 'hero_tagline': 'Razem chronimy historię',
    'hero_btn1': '🗺 Przeglądaj mapę', 'hero_btn2': 'Zobacz plany członkostwa', 'scroll': 'Przewiń, aby odkryć',
    'what_label': 'Technologia', 'what_title': 'Czym jest <span class="hl">Archeologiczny Model Predykcyjny</span>?',
    'tab_free': '🔓 Podgląd darmowy', 'tab_member': '🔐 Mapa członków',
    'layer_opacity': 'Przezroczystość warstwy', 'layer_satellite': 'Satelita', 'layer_sat_period_label': 'Historyczny', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'Miejscowości OSM', 'layer_uat': 'Granice administracyjne', 'layer_heritage': 'Dziedzictwo', 'layer_heritage_group': 'Dziedzictwo i kultura',
    'layer_historical': 'Mapy historyczne', 'layer_historical_premium': 'Mapy historyczne', 'layer_historical_eu': 'Europejskie mapy historyczne (CENAGIS / IH PAN)',
    'layer_josephine': 'Mapa józefińska +', 'layer_iosfree': 'Mapa józefińska', 'layer_austrian': 'Mapa austriacka 1910',
    'layer_firing_plans': 'Plany ogniowe', 'layer_soviet': 'Mapa radziecka 1970', 'layer_banat': 'Banat - 1769-1772',
    'layer_transylvania1859': 'Mapa Siedmiogrodu 1859', 'layer_galicia1855': 'Mapa administracyjna Galicji i Lodomerii – 1855',
    'layer_mitteleuropa': 'Übersichtskarte von Mitteleuropa 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Karta Dawnej Polski – Wojciech Chrzanowski (1859)',
    'layer_reymann': 'Reymann\'s Special-Karte von Central-Europa (1806–1908)', 'layer_kdr100k': 'Karte des Deutschen Reiches 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Karte des Deutschen Reiches – Großblatt (1914–1944)', 'layer_wig100k': 'Mapa Taktyczna Polski – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Bukowina 1861-1864', 'layer_austrohu': 'Mapa austro-węgierska 1861-1864', 'layer_moldova1868': 'Mołdawia 1868',
    'layer_moldovawwii': 'Mołdawia II', 'layer_polishtactical1933': 'Polska mapa taktyczna 1933', 'layer_ww1': 'I Wojna Światowa', 'layer_ww2': 'II Wojna Światowa',
    'layer_moldova1771': 'Mołdawia 1771', 'layer_sat60': 'Zdjęcia satelitarne z lat 60. (CORONA)',
    'layer_vegfp_group': 'Odcisk wegetacji', 'layer_vegfp_ppi': 'PPI (Wskaźnik fenologii roślin)', 'layer_vegfp_smx': 'SMX (Maksymalna wartość sezonowa)',
    'layer_vegfp_sgu': 'SGU (Tempo zazieleniania)', 'layer_vegfp_sgd': 'SGD (Tempo obumierania)',
    'layer_vegfp_date_label': 'Data', 'layer_vegfp_year_label': 'Rok', 'layer_vegfp_prev_dekad': 'Poprzednia dekada', 'layer_vegfp_next_dekad': 'Następna dekada',
    'layer_vegfp_prev_year': 'Poprzedni rok', 'layer_vegfp_next_year': 'Następny rok', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Wysokość (NMT/DTM)', 'layer_lidar_sub_dsm': 'Powierzchnia (NMP/DSM)', 'layer_lidar_sub_slope': 'Nachylenie',
    'layer_lidar_sub_aspect': 'Ekspozycja', 'layer_lidar_sub_hillshade': 'Rzeźba cieniowana (Hillshade)', 'layer_lidar_sub_tri': 'Szorstkość terenu (TRI)',
    'layer_lidar_sub_tpi': 'Pozycja topograficzna (TPI)', 'layer_lidar_sub_roughness': 'Chropowatość', 'layer_lidar_sub_curv_profile': 'Krzywizna profilowa',
    'layer_lidar_sub_curv_plan': 'Krzywizna planarna', 'layer_lidar_sub_curv_general': 'Krzywizna ogólna',
    'layer_roman': 'Cesarstwo Rzymskie', 'layer_archeo_potential': 'Strefy potencjału archeologicznego', 'layer_arch_report': 'Raport archeologiczny', 'layer_battles': 'Bitwy',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Odblokuj wszystkie warstwy premium na interaktywnej mapie.',
    'prem_login_needed': 'Aby wykupić Premium, potrzebujesz darmowego konta.', 'prem_login_btn': 'Zaloguj / Zarejestruj',
    'prem_already': 'Twój miesiąc Premium jest nadal aktywny. Dziękujemy!', 'btn_bronze': 'Kup', 'btn_silver': 'Kup', 'btn_gold': 'Kup',
    'free_title': 'Darmowe — Zawsze dostępne', 'free_btn': 'Przeglądaj darmową mapę'
})

UK = dict(EN)
UK.update({
    'nav_apm': 'Що таке APM', 'nav_map': 'Дослідити карту', 'nav_how': 'Як це працює', 'nav_pricing': 'Ціни', 'nav_useful': 'Корисна інформація', 'nav_cta': 'Отримати доступ',
    'nav_tech': 'Технологія', 'nav_process': 'Процес', 'nav_events': 'Події', 'nav_friends': 'Друзі', 'nav_logout': 'Вийти', 'nav_login': 'Увійти',
    'manage_account': 'Керувати обліковим записом', 'menu_language': 'Мова', 'menu_storage': 'Пам\'ять',
    'hero_badge': 'Археологія × Штучний Інтелект', 'hero_tagline': 'Зберігаємо історію разом',
    'hero_btn1': '🗺 Дослідити карту', 'hero_btn2': 'Плани підписки', 'scroll': 'Прокрутіть, щоб дізнатися більше',
    'what_label': 'Технологія', 'what_title': 'Що таке <span class="hl">Археологічна Прогностична Модель</span>?',
    'tab_free': '🔓 Безкоштовний огляд', 'tab_member': '🔐 Карта підписників',
    'layer_opacity': 'Прозорість шару', 'layer_satellite': 'Супутник', 'layer_sat_period_label': 'Історичний', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'Населені пункти OSM', 'layer_uat': 'Адміністративні межі', 'layer_heritage': 'Спадщина', 'layer_heritage_group': 'Спадщина та культура',
    'layer_historical': 'Історичні карти', 'layer_historical_premium': 'Історичні карти', 'layer_historical_eu': 'Європейські історичні карти (CENAGIS / IH PAN)',
    'layer_josephine': 'Йозефінська карта +', 'layer_iosfree': 'Йозефінська карта', 'layer_austrian': 'Австрійська карта 1910',
    'layer_firing_plans': 'Плани стрільби', 'layer_soviet': 'Радянська карта 1970', 'layer_banat': 'Банат - 1769-1772',
    'layer_transylvania1859': 'Карта Трансільванії 1859', 'layer_galicia1855': 'Адміністративна карта Галичини та Володимирії – 1855',
    'layer_mitteleuropa': 'Загальна карта Центральної Європи 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Карта Войцеха Хржановського (1859)',
    'layer_reymann': 'Спеціальна карта Центральної Європи – Рейманн (1806–1908)', 'layer_kdr100k': 'Карта Німецької імперії 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Карта Німецької імперії – Großblatt (1914–1944)', 'layer_wig100k': 'Польська військова карта – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Буковина 1861-1864', 'layer_austrohu': 'Австро-Угорська карта 1861-1864', 'layer_moldova1868': 'Молдова 1868',
    'layer_moldovawwii': 'Молдова II', 'layer_polishtactical1933': 'Польська тактична карта 1933', 'layer_ww1': 'Перша світова війна', 'layer_ww2': 'Друга світова війна',
    'layer_moldova1771': 'Молдова 1771', 'layer_sat60': 'Супутникові знімки 1960-х років (CORONA)',
    'layer_vegfp_group': 'Відбиток рослинності', 'layer_vegfp_ppi': 'PPI (Індекс фенології рослин)', 'layer_vegfp_smx': 'SMX (Сезонний максимум)',
    'layer_vegfp_sgu': 'SGU (Швидкість весняного озеленення)', 'layer_vegfp_sgd': 'SGD (Швидкість осіннього в\'янення)',
    'layer_vegfp_date_label': 'Дата', 'layer_vegfp_year_label': 'Рік', 'layer_vegfp_prev_dekad': 'Попередня декада', 'layer_vegfp_next_dekad': 'Наступна декада',
    'layer_vegfp_prev_year': 'Попередній рік', 'layer_vegfp_next_year': 'Наступний рік', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Рельєф (DTM)', 'layer_lidar_sub_dsm': 'Поверхня (DSM)', 'layer_lidar_sub_slope': 'Ухил',
    'layer_lidar_sub_aspect': 'Експозиція', 'layer_lidar_sub_hillshade': 'Тіньовий рельєф', 'layer_lidar_sub_tri': 'Шорсткість місцевості (TRI)',
    'layer_lidar_sub_tpi': 'Топографічне положення (TPI)', 'layer_lidar_sub_roughness': 'Шорсткість', 'layer_lidar_sub_curv_profile': 'Профільна кривизна',
    'layer_lidar_sub_curv_plan': 'Планарна кривизна', 'layer_lidar_sub_curv_general': 'Загальна кривизна',
    'layer_roman': 'Римська імперія', 'layer_archeo_potential': 'Зони археологічного потенціалу', 'layer_arch_report': 'Археологічний звіт', 'layer_battles': 'Битви',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Розблокуйте всі преміум-шари на інтерактивній карті.',
    'prem_login_needed': 'Вам потрібен безкоштовний обліковий запис для покупки Premium.', 'prem_login_btn': 'Увійти / Зареєструватися',
    'prem_already': 'Ваш місяць Premium активний. Дякуємо!', 'btn_bronze': 'Купити', 'btn_silver': 'Купити', 'btn_gold': 'Купити',
    'free_title': 'Безкоштовно — Завжди доступно', 'free_btn': 'Дослідити безкоштовну карту'
})

HU = dict(EN)
HU.update({
    'nav_apm': 'Mi az az APM', 'nav_map': 'Térkép felfedezése', 'nav_how': 'Hogyan működik', 'nav_pricing': 'Árak', 'nav_useful': 'Hasznos információk', 'nav_cta': 'Hozzáférés kérése',
    'nav_tech': 'Technológia', 'nav_process': 'Folyamat', 'nav_events': 'Események', 'nav_friends': 'Barátok', 'nav_logout': 'Kijelentkezés', 'nav_login': 'Bejelentkezés',
    'manage_account': 'Fiók kezelése', 'menu_language': 'Nyelv', 'menu_storage': 'Tárhely',
    'hero_badge': 'Régészet × Mesterséges Intelligencia', 'hero_tagline': 'Mentsük meg a történelmet együtt',
    'hero_btn1': '🗺 Térkép felfedezése', 'hero_btn2': 'Tagsági csomagok', 'scroll': 'Görgessen a felfedezéshez',
    'what_label': 'Technológia', 'what_title': 'Mi az a <span class="hl">Régészeti Előrejelzési Modell</span>?',
    'tab_free': '🔓 Ingyenes előnézet', 'tab_member': '🔐 Tagok térképe',
    'layer_opacity': 'Réteg átlátszósága', 'layer_satellite': 'Műhold', 'layer_sat_period_label': 'Történelmi', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Települések', 'layer_uat': 'Közigazgatási határok', 'layer_heritage': 'Örökség', 'layer_heritage_group': 'Örökség és kultúra',
    'layer_historical': 'Történelmi térképek', 'layer_historical_premium': 'Történelmi térképek', 'layer_historical_eu': 'Európai történelmi térképek (CENAGIS / IH PAN)',
    'layer_josephine': 'Jozefin térkép +', 'layer_iosfree': 'Jozefin térkép', 'layer_austrian': 'Osztrák térkép 1910',
    'layer_firing_plans': 'Lőtervek', 'layer_soviet': 'Szovjet térkép 1970', 'layer_banat': 'Bánság - 1769-1772',
    'layer_transylvania1859': 'Erdély térképe 1859', 'layer_galicia1855': 'Galícia és Lodoméria közigazgatási térképe – 1855',
    'layer_mitteleuropa': 'Közép-Európa áttekintő térképe 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Wojciech Chrzanowski térkép (1859)',
    'layer_reymann': 'Közép-Európa speciális térképe – Reymann (1806–1908)', 'layer_kdr100k': 'Német Birodalom térképe 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Német Birodalom térképe – Großblatt (1914–1944)', 'layer_wig100k': 'Lengyel katonai térkép – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Bukovina 1861-1864', 'layer_austrohu': 'Osztrák-Magyar térkép 1861-1864', 'layer_moldova1868': 'Moldva 1868',
    'layer_moldovawwii': 'Moldva II', 'layer_polishtactical1933': 'Lengyel taktikai térkép 1933', 'layer_ww1': 'I. Világháború', 'layer_ww2': 'II. Világháború',
    'layer_moldova1771': 'Moldva 1771', 'layer_sat60': '1960-as évekbeli műholdfelvételek (CORONA)',
    'layer_vegfp_group': 'Növényzeti ujjlenyomat', 'layer_vegfp_ppi': 'PPI (Növényfenológiai index)', 'layer_vegfp_smx': 'SMX (Szezonális csúcsérték)',
    'layer_vegfp_sgu': 'SGU (Tavaszi zöldülési sebesség)', 'layer_vegfp_sgd': 'SGD (Őszi hervadási sebesség)',
    'layer_vegfp_date_label': 'Dátum', 'layer_vegfp_year_label': 'Év', 'layer_vegfp_prev_dekad': 'Előző 10 napos időszak', 'layer_vegfp_next_dekad': 'Következő 10 napos időszak',
    'layer_vegfp_prev_year': 'Előző év', 'layer_vegfp_next_year': 'Következő év', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Domborzatmodell (DTM)', 'layer_lidar_sub_dsm': 'Felszínmodell (DSM)', 'layer_lidar_sub_slope': 'Lejtés',
    'layer_lidar_sub_aspect': 'Kitettség', 'layer_lidar_sub_hillshade': 'Domborzatárnyékolás', 'layer_lidar_sub_tri': 'Felszíni érdesség (TRI)',
    'layer_lidar_sub_tpi': 'Topográfiai pozíció (TPI)', 'layer_lidar_sub_roughness': 'Érdesség', 'layer_lidar_sub_curv_profile': 'Profilgörbület',
    'layer_lidar_sub_curv_plan': 'Sík görbület', 'layer_lidar_sub_curv_general': 'Általános görbület',
    'layer_roman': 'Római Birodalom', 'layer_archeo_potential': 'Régészeti potenciál zónák', 'layer_arch_report': 'Régészeti jelentés', 'layer_battles': 'Csaták',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Oldja fel az összes prémium réteget az interaktív térképen.',
    'prem_login_needed': 'A Premium vásárlásához ingyenes fiók szükséges.', 'prem_login_btn': 'Bejelentkezés / Regisztráció',
    'prem_already': 'A Premium hónapja még aktív. Köszönjük!', 'btn_bronze': 'Vásárlás', 'btn_silver': 'Vásárlás', 'btn_gold': 'Vásárlás',
    'free_title': 'Ingyenes — Mindig elérhető', 'free_btn': 'Ingyenes térkép felfedezése'
})

CS = dict(EN)
CS.update({
    'nav_apm': 'Co je APM', 'nav_map': 'Prozkoumat mapu', 'nav_how': 'Jak to funguje', 'nav_pricing': 'Ceník', 'nav_useful': 'Užitečné informace', 'nav_cta': 'Získat přístup',
    'nav_tech': 'Technologie', 'nav_process': 'Proces', 'nav_events': 'Události', 'nav_friends': 'Přátelé', 'nav_logout': 'Odhlásit se', 'nav_login': 'Přihlásit se',
    'manage_account': 'Spravovat účet', 'menu_language': 'Jazyk', 'menu_storage': 'Úložiště',
    'hero_badge': 'Archeologie × Umělá Inteligence', 'hero_tagline': 'Společně chráníme historii',
    'hero_btn1': '🗺 Prozkoumat mapu', 'hero_btn2': 'Zobrazit plány členství', 'scroll': 'Posuňte pro objevování',
    'what_label': 'Technologie', 'what_title': 'Co je to <span class="hl">Archeologický Prediktivní Model</span>?',
    'tab_free': '🔓 Bezplatný náhled', 'tab_member': '🔐 Mapa pro členy',
    'layer_opacity': 'Průhlednost vrstvy', 'layer_satellite': 'Satelit', 'layer_sat_period_label': 'Historický', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Místa', 'layer_uat': 'Správní hranice', 'layer_heritage': 'Dědictví', 'layer_heritage_group': 'Dědictví a kultura',
    'layer_historical': 'Historické mapy', 'layer_historical_premium': 'Historické mapy', 'layer_historical_eu': 'Evropské historické mapy (CENAGIS / IH PAN)',
    'layer_josephine': 'Josefské mapování +', 'layer_iosfree': 'Josefské mapování', 'layer_austrian': 'Rakouská mapa 1910',
    'layer_firing_plans': 'Plány střelby', 'layer_soviet': 'Sovětská mapa 1970', 'layer_banat': 'Banát - 1769-1772',
    'layer_transylvania1859': 'Mapa Sedmihradska 1859', 'layer_galicia1855': 'Administrativní mapa Haliče a Vladiměřska – 1855',
    'layer_mitteleuropa': 'Přehledná mapa Střední Evropy 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Mapa Wojciecha Chrzanowského (1859)',
    'layer_reymann': 'Speciální mapa Střední Evropy – Reymann (1806–1908)', 'layer_kdr100k': 'Mapa Německé říše 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Mapa Německé říše – Großblatt (1914–1944)', 'layer_wig100k': 'Polská vojenská mapa – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Bukovina 1861-1864', 'layer_austrohu': 'Rakousko-uherská mapa 1861-1864', 'layer_moldova1868': 'Moldávie 1868',
    'layer_moldovawwii': 'Moldávie II', 'layer_polishtactical1933': 'Polská taktická mapa 1933', 'layer_ww1': '1. světová válka', 'layer_ww2': '2. světová válka',
    'layer_moldova1771': 'Moldávie 1771', 'layer_sat60': 'Satelitní snímky ze 60. let (CORONA)',
    'layer_vegfp_group': 'Otisk vegetace', 'layer_vegfp_ppi': 'PPI (Index fenologie rostlin)', 'layer_vegfp_smx': 'SMX (Sezónní maximum)',
    'layer_vegfp_sgu': 'SGU (Rychlost jarního růstu)', 'layer_vegfp_sgd': 'SGD (Rychlost podzimního vadnutí)',
    'layer_vegfp_date_label': 'Datum', 'layer_vegfp_year_label': 'Rok', 'layer_vegfp_prev_dekad': 'Předchozí dekáda', 'layer_vegfp_next_dekad': 'Další dekáda',
    'layer_vegfp_prev_year': 'Předchozí rok', 'layer_vegfp_next_year': 'Další rok', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Digitální model terénu (DTM)', 'layer_lidar_sub_dsm': 'Digitální model povrchu (DSM)', 'layer_lidar_sub_slope': 'Sklon',
    'layer_lidar_sub_aspect': 'Orientace svahu (Aspect)', 'layer_lidar_sub_hillshade': 'Stínovaný reliéf', 'layer_lidar_sub_tri': 'Členitost terénu (TRI)',
    'layer_lidar_sub_tpi': 'Topografická pozice (TPI)', 'layer_lidar_sub_roughness': 'Drsnost', 'layer_lidar_sub_curv_profile': 'Profilová křivost',
    'layer_lidar_sub_curv_plan': 'Půdorysná křivost', 'layer_lidar_sub_curv_general': 'Celková křivost',
    'layer_roman': 'Římská říše', 'layer_archeo_potential': 'Zóny archeologického potenciálu', 'layer_arch_report': 'Archeologická zpráva', 'layer_battles': 'Bitvy',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Odemkněte všechny prémiové vrstvy na interaktivní mapě.',
    'prem_login_needed': 'K nákupu Premium potřebujete bezplatný účet.', 'prem_login_btn': 'Přihlásit se / Registrovat',
    'prem_already': 'Váš měsíc Premium je stále aktivní. Děkujeme!', 'btn_bronze': 'Koupit', 'btn_silver': 'Koupit', 'btn_gold': 'Koupit',
    'free_title': 'Zdarma — Vždy k dispozici', 'free_btn': 'Prozkoumat bezplatnou mapu'
})

SK = dict(EN)
SK.update({
    'nav_apm': 'Čo je APM', 'nav_map': 'Preskúmať mapu', 'nav_how': 'Ako to funguje', 'nav_pricing': 'Cenník', 'nav_useful': 'Užitočné informácie', 'nav_cta': 'Získať prístup',
    'nav_tech': 'Technológia', 'nav_process': 'Proces', 'nav_events': 'Udalosti', 'nav_friends': 'Priatelia', 'nav_logout': 'Odhlásiť sa', 'nav_login': 'Prihlásiť sa',
    'manage_account': 'Spravovať účet', 'menu_language': 'Jazyk', 'menu_storage': 'Úložisko',
    'hero_badge': 'Archeológia × Umelá Inteligencia', 'hero_tagline': 'Spoločne chránime históriu',
    'hero_btn1': '🗺 Preskúmať mapu', 'hero_btn2': 'Zobraziť plány členstva', 'scroll': 'Posuňte pre objavovanie',
    'what_label': 'Technológia', 'what_title': 'Čo je to <span class="hl">Archeologický Prediktívny Model</span>?',
    'tab_free': '🔓 Bezplatný náhľad', 'tab_member': '🔐 Mapa pre členov',
    'layer_opacity': 'Priehľadnosť vrstvy', 'layer_satellite': 'Satelit', 'layer_sat_period_label': 'Historický', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Miesta', 'layer_uat': 'Správne hranice', 'layer_heritage': 'Dedičstvo', 'layer_heritage_group': 'Dedičstvo a kultúra',
    'layer_historical': 'Historické mapy', 'layer_historical_premium': 'Historické mapy', 'layer_historical_eu': 'Európske historické mapy (CENAGIS / IH PAN)',
    'layer_josephine': 'Jozefínske mapovanie +', 'layer_iosfree': 'Jozefínske mapovanie', 'layer_austrian': 'Rakúska mapa 1910',
    'layer_firing_plans': 'Plány streľby', 'layer_soviet': 'Sovietska mapa 1970', 'layer_banat': 'Banát - 1769-1772',
    'layer_transylvania1859': 'Mapa Sedmohradska 1859', 'layer_galicia1855': 'Administratívna mapa Haliče a Vladimírska – 1855',
    'layer_mitteleuropa': 'Prehľadná mapa Strednej Európy 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Mapa Wojciecha Chrzanowského (1859)',
    'layer_reymann': 'Špeciálna mapa Strednej Európy – Reymann (1806–1908)', 'layer_kdr100k': 'Mapa Nemeckej ríše 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Mapa Nemeckej ríše – Großblatt (1914–1944)', 'layer_wig100k': 'Poľská vojenská mapa – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Bukovina 1861-1864', 'layer_austrohu': 'Rakúsko-uhorská mapa 1861-1864', 'layer_moldova1868': 'Moldavsko 1868',
    'layer_moldovawwii': 'Moldavsko II', 'layer_polishtactical1933': 'Poľská taktická mapa 1933', 'layer_ww1': '1. svetová vojna', 'layer_ww2': '2. svetová vojna',
    'layer_moldova1771': 'Moldavsko 1771', 'layer_sat60': 'Satelitné snímky zo 60. rokov (CORONA)',
    'layer_vegfp_group': 'Odtlačok vegetácie', 'layer_vegfp_ppi': 'PPI (Index fenológie rastlín)', 'layer_vegfp_smx': 'SMX (Sezónne maximum)',
    'layer_vegfp_sgu': 'SGU (Rýchlosť jarného rastu)', 'layer_vegfp_sgd': 'SGD (Rýchlosť jesenného vädnutia)',
    'layer_vegfp_date_label': 'Dátum', 'layer_vegfp_year_label': 'Rok', 'layer_vegfp_prev_dekad': 'Predchádzajúca dekáda', 'layer_vegfp_next_dekad': 'Ďalšia dekáda',
    'layer_vegfp_prev_year': 'Predchádzajúci rok', 'layer_vegfp_next_year': 'Ďalší rok', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Digitálny model terénu (DTM)', 'layer_lidar_sub_dsm': 'Digitálny model povrchu (DSM)', 'layer_lidar_sub_slope': 'Sklon',
    'layer_lidar_sub_aspect': 'Orientácia svahu (Aspect)', 'layer_lidar_sub_hillshade': 'Tieňovaný reliéf', 'layer_lidar_sub_tri': 'Členitosť terénu (TRI)',
    'layer_lidar_sub_tpi': 'Topografická pozícia (TPI)', 'layer_lidar_sub_roughness': 'Drsnosť', 'layer_lidar_sub_curv_profile': 'Profilová krivosť',
    'layer_lidar_sub_curv_plan': 'Pôdorysná krivosť', 'layer_lidar_sub_curv_general': 'Všeobecná krivosť',
    'layer_roman': 'Rímska ríša', 'layer_archeo_potential': 'Zóny archeologického potenciálu', 'layer_arch_report': 'Archeologická správa', 'layer_battles': 'Bitky',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Odomknite všetky prémiové vrstvy na interaktívnej mape.',
    'prem_login_needed': 'Na nákup Premium potrebujete bezplatný účet.', 'prem_login_btn': 'Prihlásiť sa / Registrovať',
    'prem_already': 'Váš mesiac Premium je stále aktívny. Ďakujeme!', 'btn_bronze': 'Kúpiť', 'btn_silver': 'Kúpiť', 'btn_gold': 'Kúpiť',
    'free_title': 'Zadarmo — Vždy k dispozícii', 'free_btn': 'Preskúmať bezplatnú mapu'
})

NL = dict(EN)
NL.update({
    'nav_apm': 'Wat is APM', 'nav_map': 'Kaart verkennen', 'nav_how': 'Hoe het werkt', 'nav_pricing': 'Prijzen', 'nav_useful': 'Nuttige informatie', 'nav_cta': 'Toegang krijgen',
    'nav_tech': 'Technologie', 'nav_process': 'Proces', 'nav_events': 'Evenementen', 'nav_friends': 'Vrienden', 'nav_logout': 'Uitloggen', 'nav_login': 'Inloggen',
    'manage_account': 'Account beheren', 'menu_language': 'Taal', 'menu_storage': 'Opslag',
    'hero_badge': 'Archeologie × Kunstmatige Intelligentie', 'hero_tagline': 'Samen geschiedenis bewaren',
    'hero_btn1': '🗺 Kaart verkennen', 'hero_btn2': 'Bekijk lidmaatschapsplannen', 'scroll': 'Scroll om te ontdekken',
    'what_label': 'Technologie', 'what_title': 'Wat is een <span class="hl">Archeologisch Voorspellingsmodel</span>?',
    'tab_free': '🔓 Gratis voorvertoning', 'tab_member': '🔐 Ledenkaart',
    'layer_opacity': 'Laagdekking', 'layer_satellite': 'Satelliet', 'layer_sat_period_label': 'Historisch', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM-Plaatsen', 'layer_uat': 'Bestuurlijke grenzen', 'layer_heritage': 'Erfgoed', 'layer_heritage_group': 'Erfgoed & Cultuur',
    'layer_historical': 'Historische kaarten', 'layer_historical_premium': 'Historische kaarten', 'layer_historical_eu': 'Europese historische kaarten (CENAGIS / IH PAN)',
    'layer_josephine': 'Jozefinische kaart +', 'layer_iosfree': 'Jozefinische kaart', 'layer_austrian': 'Oostenrijkse kaart 1910',
    'layer_firing_plans': 'Vuurplannen', 'layer_soviet': 'Sovjetkaart 1970', 'layer_banat': 'Banaat - 1769-1772',
    'layer_transylvania1859': 'Kaart van Transsylvanië 1859', 'layer_galicia1855': 'Administratieve kaart van Galicië en Lodomerië – 1855',
    'layer_mitteleuropa': 'Overzichtskaart van Midden-Europa 1:300.000 (1893–1945)', 'layer_chrzanowski': 'Wojciech Chrzanowski Kaart (1859)',
    'layer_reymann': 'Speciale kaart van Midden-Europa – Reymann (1806–1908)', 'layer_kdr100k': 'Kaart van het Duitse Rijk 1:100.000 (1878–1945)',
    'layer_kdr_gb': 'Kaart van het Duitse Rijk – Großblatt (1914–1944)', 'layer_wig100k': 'Poolse militaire kaart – WIG 1:100.000 (1919–1939)',
    'layer_bucovina': 'Boekovina 1861-1864', 'layer_austrohu': 'Oostenrijks-Hongaarse kaart 1861-1864', 'layer_moldova1868': 'Moldavië 1868',
    'layer_moldovawwii': 'Moldavië II', 'layer_polishtactical1933': 'Poolse tactische kaart 1933', 'layer_ww1': 'Eerste Wereldoorlog', 'layer_ww2': 'Tweede Wereldoorlog',
    'layer_moldova1771': 'Moldavië 1771', 'layer_sat60': 'Satellietbeelden uit de jaren 60 (CORONA)',
    'layer_vegfp_group': 'Vegetatie-voetafdruk', 'layer_vegfp_ppi': 'PPI (Plantenfenologie-index)', 'layer_vegfp_smx': 'SMX (Seizoenspiekwaarde)',
    'layer_vegfp_sgu': 'SGU (Snelheid voorjaarsgroei)', 'layer_vegfp_sgd': 'SGD (Snelheid najaarsverwelking)',
    'layer_vegfp_date_label': 'Datum', 'layer_vegfp_year_label': 'Jaar', 'layer_vegfp_prev_dekad': 'Vorige tiendaagse periode', 'layer_vegfp_next_dekad': 'Volgende tiendaagse periode',
    'layer_vegfp_prev_year': 'Vorig jaar', 'layer_vegfp_next_year': 'Volgend jaar', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Hoogtemodel (DTM)', 'layer_lidar_sub_dsm': 'Oppervlaktemodel (DSM)', 'layer_lidar_sub_slope': 'Helling',
    'layer_lidar_sub_aspect': 'Expositie (Aspect)', 'layer_lidar_sub_hillshade': 'Reliëfschaduw', 'layer_lidar_sub_tri': 'Terreinruwheid (TRI)',
    'layer_lidar_sub_tpi': 'Topografische positie (TPI)', 'layer_lidar_sub_roughness': 'Ruwheid', 'layer_lidar_sub_curv_profile': 'Profielkromming',
    'layer_lidar_sub_curv_plan': 'Plankromming', 'layer_lidar_sub_curv_general': 'Algemene kromming',
    'layer_roman': 'Romeinse Rijk', 'layer_archeo_potential': 'Archeologische potentieelzones', 'layer_arch_report': 'Archeologisch rapport', 'layer_battles': 'Veldslagen',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Ontgrendel alle premiumlagen op de interactieve kaart.',
    'prem_login_needed': 'U heeft een gratis account nodig om Premium te kopen.', 'prem_login_btn': 'Inloggen / Registreren',
    'prem_already': 'Uw Premium-maand is nog actief. Bedankt!', 'btn_bronze': 'Kopen', 'btn_silver': 'Kopen', 'btn_gold': 'Kopen',
    'free_title': 'Gratis — Altijd beschikbaar', 'free_btn': 'Gratis kaart verkennen'
})

# Complete multilingual dictionary
ALL_LANGS = {
    'en': EN,
    'ro': RO,
    'de': DE,
    'fr': FR,
    'it': IT,
    'es': ES,
    'pl': PL,
    'uk': UK,
    'hu': HU,
    'cs': CS,
    'sk': SK,
    'nl': NL,
    'bg': dict(EN),
    'el': dict(EN),
    'pt': dict(EN),
    'da': dict(EN),
    'sv': dict(EN),
    'no': dict(EN),
    'fi': dict(EN),
    'et': dict(EN),
    'lv': dict(EN),
    'lt': dict(EN),
    'hr': dict(EN),
    'sr': dict(EN),
    'sl': dict(EN)
}

# Add translations for BG, EL, PT, DA, SV, NO, FI, ET, LV, LT, HR, SR, SL
ALL_LANGS['bg'].update({
    'nav_apm': 'Какво е APM', 'nav_map': 'Разгледай картата', 'nav_how': 'Как работи', 'nav_pricing': 'Цени', 'nav_useful': 'Полезна информация', 'nav_cta': 'Вход / Достъп',
    'layer_opacity': 'Прозрачност на слоя', 'layer_satellite': 'Сателит', 'layer_sat_period_label': 'Исторически', 'layer_sat_period_present': '2025',
    'layer_historical': 'Исторически карти', 'layer_historical_eu': 'Европейски исторически карти (CENAGIS / IH PAN)',
    'layer_roman': 'Римска империя', 'layer_archeo_potential': 'Зони с археологически потенциал', 'layer_battles': 'Бит hostки'
})
ALL_LANGS['el'].update({
    'nav_apm': 'Τι είναι το APM', 'nav_map': 'Εξερεύνηση χάρτη', 'nav_how': 'Πώς λειτουργεί', 'nav_pricing': 'Τιμές', 'nav_useful': 'Χρήσιμες πληροφορίες', 'nav_cta': 'Απόκτηση πρόσβασης',
    'layer_opacity': 'Διαφάνεια επιπέδου', 'layer_satellite': 'Δορυφόρος', 'layer_sat_period_label': 'Ιστορικό', 'layer_sat_period_present': '2025',
    'layer_historical': 'Ιστορικοί χάρτες', 'layer_historical_eu': 'Ευρωπαϊκοί ιστορικοί χάρτες (CENAGIS / IH PAN)',
    'layer_roman': 'Ρωμαϊκή Αυτοκρατορία', 'layer_archeo_potential': 'Ζώνες αρχαιολογικού δυναμικού', 'layer_battles': 'Μάχες'
})
ALL_LANGS['pt'].update({
    'nav_apm': 'O que é o APM', 'nav_map': 'Explorar o mapa', 'nav_how': 'Como funciona', 'nav_pricing': 'Preços', 'nav_useful': 'Informações úteis', 'nav_cta': 'Obter acesso',
    'layer_opacity': 'Opacidade da camada', 'layer_satellite': 'Satélite', 'layer_sat_period_label': 'Histórico', 'layer_sat_period_present': '2025',
    'layer_historical': 'Mapas históricos', 'layer_historical_eu': 'Mapas históricos europeus (CENAGIS / IH PAN)',
    'layer_roman': 'Império Romano', 'layer_archeo_potential': 'Zonas com potencial arqueológico', 'layer_battles': 'Batalhas'
})
PT = dict(EN)
PT.update({
    'nav_apm': 'O que é o APM', 'nav_map': 'Explorar o mapa', 'nav_how': 'Como funciona', 'nav_pricing': 'Preços', 'nav_useful': 'Informações úteis', 'nav_cta': 'Obter acesso',
    'nav_tech': 'Tecnologia', 'nav_process': 'Processo', 'nav_events': 'Eventos', 'nav_friends': 'Amigos', 'nav_logout': 'Sair', 'nav_login': 'Entrar',
    'manage_account': 'Gerir conta', 'menu_language': 'Idioma', 'menu_storage': 'Armazenamento',
    'hero_badge': 'Arqueologia × Inteligência Artificial', 'hero_tagline': 'Juntos protegemos a história',
    'hero_btn1': '🗺 Explorar o mapa', 'hero_btn2': 'Ver planos de adesão', 'scroll': 'Deslize para descobrir',
    'what_label': 'Tecnologia', 'what_title': 'O que é o <span class="hl">Modelo Preditivo Arqueológico</span>?',
    'tab_free': '🔓 Pré-visualização gratuita', 'tab_member': '🔐 Mapa para membros',
    'layer_opacity': 'Opacidade da camada', 'layer_satellite': 'Satélite', 'layer_sat_period_label': 'Histórico', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'Localidades OSM', 'layer_uat': 'Limites administrativos', 'layer_heritage': 'Património', 'layer_heritage_group': 'Património e cultura',
    'layer_historical': 'Mapas históricos', 'layer_historical_premium': 'Mapas históricos', 'layer_historical_eu': 'Mapas históricos europeus (CENAGIS / IH PAN)',
    'layer_josephine': 'Mapeamento Josefino +', 'layer_iosfree': 'Mapeamento Josefino', 'layer_austrian': 'Mapa austríaco 1910',
    'layer_firing_plans': 'Planos de tiro', 'layer_soviet': 'Mapa soviético 1970', 'layer_banat': 'Banat - 1769-1772',
    'layer_transylvania1859': 'Mapa da Transilvânia 1859', 'layer_galicia1855': 'Mapa Administrativo da Galícia e Lodoméria – 1855',
    'layer_mitteleuropa': 'Mapa Geral da Europa Central 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Mapa de Wojciech Chrzanowski (1859)',
    'layer_reymann': 'Mapa Especial da Europa Central – Reymann (1806–1908)', 'layer_kdr100k': 'Mapa do Império Alemão 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Mapa do Império Alemão – Großblatt (1914–1944)', 'layer_wig100k': 'Mapa Militar Polaco – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Bucovina 1861-1864', 'layer_austrohu': 'Mapa austro-húngaro 1861-1864', 'layer_moldova1868': 'Moldávia 1868',
    'layer_moldovawwii': 'Moldávia II', 'layer_polishtactical1933': 'Mapa tático polaco 1933', 'layer_ww1': 'Primeira Guerra Mundial', 'layer_ww2': 'Segunda Guerra Mundial',
    'layer_moldova1771': 'Moldávia 1771', 'layer_sat60': 'Imagens de satélite dos anos 60 (CORONA)',
    'layer_vegfp_group': 'Pegada de vegetação', 'layer_vegfp_ppi': 'PPI (Índice fenológico das plantas)', 'layer_vegfp_smx': 'SMX (Valor máximo sazonal)',
    'layer_vegfp_sgu': 'SGU (Taxa de esverdecimento sazonal)', 'layer_vegfp_sgd': 'SGD (Taxa de senescência sazonal)',
    'layer_vegfp_date_label': 'Data', 'layer_vegfp_year_label': 'Ano', 'layer_vegfp_prev_dekad': 'Década anterior', 'layer_vegfp_next_dekad': 'Década seguinte',
    'layer_vegfp_prev_year': 'Ano anterior', 'layer_vegfp_next_year': 'Ano seguinte', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Elevação (MDT)', 'layer_lidar_sub_dsm': 'Superfície (MDS)', 'layer_lidar_sub_slope': 'Declive',
    'layer_lidar_sub_aspect': 'Orientação (Aspect)', 'layer_lidar_sub_hillshade': 'Relevo sombreado', 'layer_lidar_sub_tri': 'Rugosidade do terreno (TRI)',
    'layer_lidar_sub_tpi': 'Posição topográfica (TPI)', 'layer_lidar_sub_roughness': 'Rugosidade', 'layer_lidar_sub_curv_profile': 'Curvatura de perfil',
    'layer_lidar_sub_curv_plan': 'Curvatura de plano', 'layer_lidar_sub_curv_general': 'Curvatura geral',
    'layer_roman': 'Império Romano', 'layer_archeo_potential': 'Zonas com potencial arqueológico', 'layer_arch_report': 'Relatório arqueológico', 'layer_battles': 'Batalhas',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Desbloqueie todas as camadas premium no mapa interativo.',
    'prem_login_needed': 'Precisa de uma conta gratuita para comprar o Premium.', 'prem_login_btn': 'Iniciar sessão / Registar',
    'prem_already': 'O seu mês Premium ainda está ativo. Obrigado!', 'btn_bronze': 'Comprar', 'btn_silver': 'Comprar', 'btn_gold': 'Comprar',
    'free_title': 'Gratuito — Sempre disponível', 'free_btn': 'Explorar mapa gratuito'
})

RU = dict(EN)
RU.update({
    'nav_apm': 'Что такое APM', 'nav_map': 'Исследовать карту', 'nav_how': 'Как это работает', 'nav_pricing': 'Цены', 'nav_useful': 'Полезная информация', 'nav_cta': 'Получить доступ',
    'nav_tech': 'Технологии', 'nav_process': 'Процесс', 'nav_events': 'События', 'nav_friends': 'Друзья', 'nav_logout': 'Выйти', 'nav_login': 'Войти',
    'manage_account': 'Управление аккаунтом', 'menu_language': 'Язык', 'menu_storage': 'Память',
    'hero_badge': 'Археология × Искусственный Интеллект', 'hero_tagline': 'Вместе защищаем историю',
    'hero_btn1': '🗺 Исследовать карту', 'hero_btn2': 'Тарифные планы', 'scroll': 'Прокрутите для просмотра',
    'what_label': 'Технологии', 'what_title': 'Что такое <span class="hl">Археологическая Предиктивная Модель</span>?',
    'tab_free': '🔓 Бесплатный просмотр', 'tab_member': '🔐 Карта участников',
    'layer_opacity': 'Прозрачность слоя', 'layer_satellite': 'Спутник', 'layer_sat_period_label': 'Исторический', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'Населенные пункты OSM', 'layer_uat': 'Административные границы', 'layer_heritage': 'Наследие', 'layer_heritage_group': 'Наследие и культура',
    'layer_historical': 'Исторические карты', 'layer_historical_premium': 'Исторические карты', 'layer_historical_eu': 'Европейские исторические карты (CENAGIS / IH PAN)',
    'layer_josephine': 'Карта Иосифа +', 'layer_iosfree': 'Карта Иосифа', 'layer_austrian': 'Австрийская карта 1910',
    'layer_firing_plans': 'Планы стрельб', 'layer_soviet': 'Советская карта 1970', 'layer_banat': 'Банат - 1769-1772',
    'layer_transylvania1859': 'Карта Трансильвании 1859', 'layer_galicia1855': 'Административная карта Галиции и Лодомерии – 1855',
    'layer_mitteleuropa': 'Обзорная карта Центральной Европы 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Карта Войцеха Хржановского (1859)',
    'layer_reymann': 'Специальная карта Центральной Европы – Рейман (1806–1908)', 'layer_kdr100k': 'Карта Германской империи 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Карта Германской империи – Großblatt (1914–1944)', 'layer_wig100k': 'Польская военная карта – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Буковина 1861-1864', 'layer_austrohu': 'Австро-венгерская карта 1861-1864', 'layer_moldova1868': 'Молдавия 1868',
    'layer_moldovawwii': 'Молдавия II', 'layer_polishtactical1933': 'Польская тактическая карта 1933', 'layer_ww1': 'Первая мировая война', 'layer_ww2': 'Вторая мировая война',
    'layer_moldova1771': 'Молдавия 1771', 'layer_sat60': 'Спутниковые снимки 60-х годов (CORONA)',
    'layer_vegfp_group': 'Отпечаток растительности', 'layer_vegfp_ppi': 'PPI (Индекс фенологии растений)', 'layer_vegfp_smx': 'SMX (Сезонный максимум)',
    'layer_vegfp_sgu': 'SGU (Скорость сезонного озеленения)', 'layer_vegfp_sgd': 'SGD (Скорость сезонного увядания)',
    'layer_vegfp_date_label': 'Дата', 'layer_vegfp_year_label': 'Год', 'layer_vegfp_prev_dekad': 'Предыдущая декада', 'layer_vegfp_next_dekad': 'Следующая декада',
    'layer_vegfp_prev_year': 'Предыдущий год', 'layer_vegfp_next_year': 'Следующий год', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Цифровая модель рельефа (DTM)', 'layer_lidar_sub_dsm': 'Цифровая модель поверхности (DSM)', 'layer_lidar_sub_slope': 'Уклон',
    'layer_lidar_sub_aspect': 'Экспозиция склонов (Aspect)', 'layer_lidar_sub_hillshade': 'Отмывка рельефа', 'layer_lidar_sub_tri': 'Индекс расчлененности рельефа (TRI)',
    'layer_lidar_sub_tpi': 'Топографическая позиция (TPI)', 'layer_lidar_sub_roughness': 'Шероховатость', 'layer_lidar_sub_curv_profile': 'Профильная кривизна',
    'layer_lidar_sub_curv_plan': 'Плановая кривизна', 'layer_lidar_sub_curv_general': 'Общая кривизна',
    'layer_roman': 'Римская империя', 'layer_archeo_potential': 'Зоны археологического потенциала', 'layer_arch_report': 'Археологический отчет', 'layer_battles': 'Битвы',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Разблокируйте все премиум-слои на интерактивной карте.',
    'prem_login_needed': 'Для покупки Premium необходим бесплатный аккаунт.', 'prem_login_btn': 'Войти / Зарегистрироваться',
    'prem_already': 'Ваш премиум-месяц активен. Спасибо!', 'btn_bronze': 'Купить', 'btn_silver': 'Купить', 'btn_gold': 'Купить',
    'free_title': 'Бесплатно — Всегда доступно', 'free_btn': 'Открыть бесплатную карту'
})

BG = dict(EN)
BG.update({
    'nav_apm': 'Какво е APM', 'nav_map': 'Разгледай картата', 'nav_how': 'Как работи', 'nav_pricing': 'Цени', 'nav_useful': 'Полезна информация', 'nav_cta': 'Вземи достъп',
    'nav_tech': 'Технология', 'nav_process': 'Процес', 'nav_events': 'Събития', 'nav_friends': 'Приятели', 'nav_logout': 'Изход', 'nav_login': 'Вход',
    'manage_account': 'Управление на профила', 'menu_language': 'Език', 'menu_storage': 'Памет',
    'hero_badge': 'Археология × Изкуствен Интелект', 'hero_tagline': 'Заедно защитаваме историята',
    'hero_btn1': '🗺 Разгледай картата', 'hero_btn2': 'Виж абонаментните планове', 'scroll': 'Превъртете за откриване',
    'what_label': 'Технология', 'what_title': 'Какво представлява <span class="hl">Археологическият Прогностичен Модел</span>?',
    'tab_free': '🔓 Безплатен преглед', 'tab_member': '🔐 Карта за членове',
    'layer_opacity': 'Прозрачност на слоя', 'layer_satellite': 'Сателит', 'layer_sat_period_label': 'Исторически', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Селища', 'layer_uat': 'Административни граници', 'layer_heritage': 'Наследство', 'layer_heritage_group': 'Наследство и култура',
    'layer_historical': 'Исторически карти', 'layer_historical_premium': 'Исторически карти', 'layer_historical_eu': 'Европейски исторически карти (CENAGIS / IH PAN)',
    'layer_josephine': 'Йозефинска карта +', 'layer_iosfree': 'Йозефинска карта', 'layer_austrian': 'Австрийска карта 1910',
    'layer_firing_plans': 'Планове за стрелба', 'layer_soviet': 'Съветска карта 1970', 'layer_banat': 'Банат - 1769-1772',
    'layer_transylvania1859': 'Карта на Трансилвания 1859', 'layer_galicia1855': 'Административна карта на Галиция и Лодомерия – 1855',
    'layer_mitteleuropa': 'Обзорна карта на Централна Европа 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Карта на Войчех Хшановски (1859)',
    'layer_reymann': 'Специална карта на Централна Европа – Рейман (1806–1908)', 'layer_kdr100k': 'Карта на Германската империя 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Карта на Германската империя – Großblatt (1914–1944)', 'layer_wig100k': 'Полска военна карта – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Буковина 1861-1864', 'layer_austrohu': 'Австро-унгарска карта 1861-1864', 'layer_moldova1868': 'Молдова 1868',
    'layer_moldovawwii': 'Молдова II', 'layer_polishtactical1933': 'Полска тактическа карта 1933', 'layer_ww1': 'Първа световна война', 'layer_ww2': 'Втора световна война',
    'layer_moldova1771': 'Молдова 1771', 'layer_sat60': 'Сателитни снимки от 60-те години (CORONA)',
    'layer_vegfp_group': 'Растителен отпечатък', 'layer_vegfp_ppi': 'PPI (Индекс на растителна фенология)', 'layer_vegfp_smx': 'SMX (Сезонен максимум)',
    'layer_vegfp_sgu': 'SGU (Скорост на сезонно разлистване)', 'layer_vegfp_sgd': 'SGD (Скорост на сезонно увяхване)',
    'layer_vegfp_date_label': 'Дата', 'layer_vegfp_year_label': 'Година', 'layer_vegfp_prev_dekad': 'Предишна декада', 'layer_vegfp_next_dekad': 'Следваща декада',
    'layer_vegfp_prev_year': 'Предишна година', 'layer_vegfp_next_year': 'Следваща година', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Цифров модел на релефа (DTM)', 'layer_lidar_sub_dsm': 'Цифров модел на повърхността (DSM)', 'layer_lidar_sub_slope': 'Наклон',
    'layer_lidar_sub_aspect': 'Изложение на склона (Aspect)', 'layer_lidar_sub_hillshade': 'Засенчен релеф', 'layer_lidar_sub_tri': 'Индекс на грапавост на терена (TRI)',
    'layer_lidar_sub_tpi': 'Топографска позиция (TPI)', 'layer_lidar_sub_roughness': 'Грапавост', 'layer_lidar_sub_curv_profile': 'Профилна кривина',
    'layer_lidar_sub_curv_plan': 'Планова кривина', 'layer_lidar_sub_curv_general': 'Обща кривина',
    'layer_roman': 'Римска империя', 'layer_archeo_potential': 'Зони с археологически потенциал', 'layer_arch_report': 'Археологически доклад', 'layer_battles': 'Битки',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Отключете всички премиум слоеве на интерактивната карта.',
    'prem_login_needed': 'Имате нужда от безплатен профил, за да закупите Premium.', 'prem_login_btn': 'Вход / Регистрация',
    'prem_already': 'Вашият Premium месец все още е активен. Благодарим ви!', 'btn_bronze': 'Купи', 'btn_silver': 'Купи', 'btn_gold': 'Купи',
    'free_title': 'Безплатно — Винаги достъпно', 'free_btn': 'Разгледай безплатната карта'
})

HR = dict(EN)
HR.update({
    'nav_apm': 'Što je APM', 'nav_map': 'Istraži kartu', 'nav_how': 'Kako to radi', 'nav_pricing': 'Cijene', 'nav_useful': 'Korisne informacije', 'nav_cta': 'Ostvari pristup',
    'nav_tech': 'Tehnologija', 'nav_process': 'Proces', 'nav_events': 'Događaji', 'nav_friends': 'Prijatelji', 'nav_logout': 'Odjava', 'nav_login': 'Prijava',
    'manage_account': 'Upravljanje računom', 'menu_language': 'Jezik', 'menu_storage': 'Pohrana',
    'hero_badge': 'Arheologija × Umjetna Inteligencija', 'hero_tagline': 'Zajedno štitimo povijest',
    'hero_btn1': '🗺 Istraži kartu', 'hero_btn2': 'Pregled planova članstva', 'scroll': 'Pomaknite za otkrivanje',
    'what_label': 'Tehnologija', 'what_title': 'Što je <span class="hl">Arheološki Prediktivni Model</span>?',
    'tab_free': '🔓 Besplatni pregled', 'tab_member': '🔐 Karta za članove',
    'layer_opacity': 'Prozirnost sloja', 'layer_satellite': 'Satelit', 'layer_sat_period_label': 'Povijesni', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Naselja', 'layer_uat': 'Administrativne granice', 'layer_heritage': 'Baština', 'layer_heritage_group': 'Baština i kultura',
    'layer_historical': 'Povijesne karte', 'layer_historical_premium': 'Povijesne karte', 'layer_historical_eu': 'Europske povijesne karte (CENAGIS / IH PAN)',
    'layer_josephine': 'Jozefinska karta +', 'layer_iosfree': 'Jozefinska karta', 'layer_austrian': 'Austrijska karta 1910',
    'layer_firing_plans': 'Planovi gađanja', 'layer_soviet': 'Sovjetska karta 1970', 'layer_banat': 'Banat - 1769-1772',
    'layer_transylvania1859': 'Karta Transilvanije 1859', 'layer_galicia1855': 'Administrativna karta Galicije i Lodomerije – 1855',
    'layer_mitteleuropa': 'Pregledna karta Srednje Europe 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Karta Wojciecha Chrzanowskog (1859)',
    'layer_reymann': 'Specijalna karta Srednje Europe – Reymann (1806–1908)', 'layer_kdr100k': 'Karta Njemačkog Carstva 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Karta Njemačkog Carstva – Großblatt (1914–1944)', 'layer_wig100k': 'Poljska vojna karta – WIG 1:100 000 (1919–1939)',
    'layer_bucovina': 'Bukovina 1861-1864', 'layer_austrohu': 'Austrougarska karta 1861-1864', 'layer_moldova1868': 'Moldavija 1868',
    'layer_moldovawwii': 'Moldavija II', 'layer_polishtactical1933': 'Poljska taktička karta 1933', 'layer_ww1': 'Prvi svjetski rat', 'layer_ww2': 'Drugi svjetski rat',
    'layer_moldova1771': 'Moldavija 1771', 'layer_sat60': 'Satelitske snimke iz 60-ih (CORONA)',
    'layer_vegfp_group': 'Otisak vegetacije', 'layer_vegfp_ppi': 'PPI (Indeks fenologije biljaka)', 'layer_vegfp_smx': 'SMX (Sezonski maksimum)',
    'layer_vegfp_sgu': 'SGU (Stopa sezonskog ozelenjavanja)', 'layer_vegfp_sgd': 'SGD (Stopa sezonskog venuća)',
    'layer_vegfp_date_label': 'Datum', 'layer_vegfp_year_label': 'Godina', 'layer_vegfp_prev_dekad': 'Prethodna dekada', 'layer_vegfp_next_dekad': 'Sljedeća dekada',
    'layer_vegfp_prev_year': 'Prethodna godina', 'layer_vegfp_next_year': 'Sljedeća godina', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_lidar': 'LIDAR', 'layer_lidar_sub_dtm': 'Digitalni model terena (DTM)', 'layer_lidar_sub_dsm': 'Digitalni model površine (DSM)', 'layer_lidar_sub_slope': 'Nagib',
    'layer_lidar_sub_aspect': 'Orijentacija padina (Aspect)', 'layer_lidar_sub_hillshade': 'Zasjenjeni reljef', 'layer_lidar_sub_tri': 'Indeks hrapavosti terena (TRI)',
    'layer_lidar_sub_tpi': 'Topografska pozicija (TPI)', 'layer_lidar_sub_roughness': 'Hrapavost', 'layer_lidar_sub_curv_profile': 'Profilna zakrivljenost',
    'layer_lidar_sub_curv_plan': 'Tlocrtna zakrivljenost', 'layer_lidar_sub_curv_general': 'Opća zakrivljenost',
    'layer_roman': 'Rimsko Carstvo', 'layer_archeo_potential': 'Zone arheološkog potencijala', 'layer_arch_report': 'Arheološko izvješće', 'layer_battles': 'Bitke',
    'prem_modal_title': 'DetectLab Premium', 'prem_modal_sub': 'Otključajte sve premium slojeve na interaktivnoj karti.',
    'prem_login_needed': 'Za kupnju Premiuma potreban vam je besplatan račun.', 'prem_login_btn': 'Prijava / Registracija',
    'prem_already': 'Vaš Premium mjesec je još uvijek aktivan. Hvala vam!', 'btn_bronze': 'Kupi', 'btn_silver': 'Kupi', 'btn_gold': 'Kupi',
    'free_title': 'Besplatno — Uvijek dostupno', 'free_btn': 'Istraži besplatnu kartu'
})

DA = dict(EN)
DA.update({
    'nav_apm': 'Hvad er APM', 'nav_map': 'Udforsk kort', 'nav_how': 'Sådan fungerer det', 'nav_pricing': 'Priser', 'nav_useful': 'Nyttig information', 'nav_cta': 'Få adgang',
    'nav_tech': 'Teknologi', 'nav_process': 'Proces', 'nav_events': 'Begivenheder', 'nav_friends': 'Venner', 'nav_logout': 'Log ud', 'nav_login': 'Log ind',
    'layer_opacity': 'Lagets gennemsigtighed', 'layer_satellite': 'Satellit', 'layer_sat_period_label': 'Historisk', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Steder', 'layer_uat': 'Administrative grænser', 'layer_heritage': 'Kulturarv', 'layer_heritage_group': 'Kulturarv og kultur',
    'layer_historical': 'Historiske kort', 'layer_historical_premium': 'Historiske kort', 'layer_historical_eu': 'Europæiske historiske kort (CENAGIS / IH PAN)',
    'layer_josephine': 'Josefinske kort +', 'layer_iosfree': 'Josefinske kort', 'layer_austrian': 'Østrigsk kort 1910',
    'layer_firing_plans': 'Skydeplaner', 'layer_soviet': 'Sovjetisk kort 1970', 'layer_banat': 'Banat - 1769-1772',
    'layer_transylvania1859': 'Kort over Transsylvanien 1859', 'layer_galicia1855': 'Administrativt kort over Galicien og Lodomerien – 1855',
    'layer_mitteleuropa': 'Oversigtskort over Mellemeuropa 1:300 000 (1893–1945)', 'layer_chrzanowski': 'Wojciech Chrzanowski-kort (1859)',
    'layer_reymann': 'Specialkort over Mellemeuropa – Reymann (1806–1908)', 'layer_kdr100k': 'Det Tyske Riges kort 1:100 000 (1878–1945)',
    'layer_kdr_gb': 'Det Tyske Riges kort – Großblatt (1914–1944)', 'layer_wig100k': 'Polsk militærkort – WIG 1:100 000 (1919–1939)',
    'layer_vegfp_group': 'Vegetationsfingeraftryk', 'layer_vegfp_ppi': 'PPI (Plantefænologisk indeks)', 'layer_vegfp_smx': 'SMX (Sæsonmæssig maksimumværdi)',
    'layer_vegfp_sgu': 'SGU (Sæsonmæssig grønningshastighed)', 'layer_vegfp_sgd': 'SGD (Sæsonmæssig visningshastighed)',
    'layer_vegfp_date_label': 'Dato', 'layer_vegfp_year_label': 'År', 'layer_vegfp_prev_dekad': 'Forrige 10-dages periode', 'layer_vegfp_next_dekad': 'Næste 10-dages periode',
    'layer_vegfp_prev_year': 'Forrige år', 'layer_vegfp_next_year': 'Næste år', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Romerriget', 'layer_archeo_potential': 'Arkæologiske potentialzoner', 'layer_battles': 'Slag'
})

SV = dict(EN)
SV.update({
    'nav_apm': 'Vad är APM', 'nav_map': 'Utforska kartan', 'nav_how': 'Hur det fungerar', 'nav_pricing': 'Priser', 'nav_useful': 'Användbar information', 'nav_cta': 'Få tillgång',
    'nav_tech': 'Teknologi', 'nav_process': 'Process', 'nav_events': 'Evenemang', 'nav_friends': 'Vänner', 'nav_logout': 'Logga ut', 'nav_login': 'Logga in',
    'layer_opacity': 'Lagens opacitet', 'layer_satellite': 'Satellit', 'layer_sat_period_label': 'Historisk', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Platser', 'layer_uat': 'Administrativa gränser', 'layer_heritage': 'Kulturarv', 'layer_heritage_group': 'Kulturarv och kultur',
    'layer_historical': 'Historiska kartor', 'layer_historical_premium': 'Historiska kartor', 'layer_historical_eu': 'Europeiska historiska kartor (CENAGIS / IH PAN)',
    'layer_josephine': 'Josefinska kartor +', 'layer_iosfree': 'Josefinska kartor', 'layer_austrian': 'Österrikisk karta 1910',
    'layer_vegfp_group': 'Vegetationsfingeravtryck', 'layer_vegfp_ppi': 'PPI (Växtfenologiskt index)', 'layer_vegfp_smx': 'SMX (Säsongens maxvärde)',
    'layer_vegfp_sgu': 'SGU (Säsongens grönskningshastighet)', 'layer_vegfp_sgd': 'SGD (Säsongens vissningshastighet)',
    'layer_vegfp_date_label': 'Datum', 'layer_vegfp_year_label': 'År', 'layer_vegfp_prev_dekad': 'Föregående 10-dagarsperiod', 'layer_vegfp_next_dekad': 'Nästa 10-dagarsperiod',
    'layer_vegfp_prev_year': 'Föregående år', 'layer_vegfp_next_year': 'Nästa år', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Romerska riket', 'layer_archeo_potential': 'Arkeologiska potentialzoner', 'layer_battles': 'Slag'
})

NO = dict(EN)
NO.update({
    'nav_apm': 'Hva er APM', 'nav_map': 'Utforsk kartet', 'nav_how': 'Hvordan det fungerer', 'nav_pricing': 'Priser', 'nav_useful': 'Nyttig informasjon', 'nav_cta': 'Få tilgang',
    'nav_tech': 'Teknologi', 'nav_process': 'Prosess', 'nav_events': 'Arrangementer', 'nav_friends': 'Venner', 'nav_logout': 'Logg ut', 'nav_login': 'Logg inn',
    'layer_opacity': 'Lagets gjennomsiktighet', 'layer_satellite': 'Satellitt', 'layer_sat_period_label': 'Historisk', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Steder', 'layer_uat': 'Administrative grenser', 'layer_heritage': 'Kulturarv', 'layer_heritage_group': 'Kulturarv og kultur',
    'layer_historical': 'Historiske kart', 'layer_historical_premium': 'Historiske kart', 'layer_historical_eu': 'Europeiske historiske kart (CENAGIS / IH PAN)',
    'layer_vegfp_group': 'Vegetasjonsfingeravtrykk', 'layer_vegfp_ppi': 'PPI (Plantefenologisk indeks)', 'layer_vegfp_smx': 'SMX (Sesongens maksimumverdi)',
    'layer_vegfp_sgu': 'SGU (Sesongmessig grønnhastighet)', 'layer_vegfp_sgd': 'SGD (Sesongmessig visningshastighet)',
    'layer_vegfp_date_label': 'Dato', 'layer_vegfp_year_label': 'År', 'layer_vegfp_prev_dekad': 'Forrige 10-dagersperiode', 'layer_vegfp_next_dekad': 'Neste 10-dagesperiode',
    'layer_vegfp_prev_year': 'Forrige år', 'layer_vegfp_next_year': 'Neste år', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Romerriket', 'layer_archeo_potential': 'Arkeologiske potensialsoner', 'layer_battles': 'Slag'
})

FI = dict(EN)
FI.update({
    'nav_apm': 'Mikä on APM', 'nav_map': 'Tutki karttaa', 'nav_how': 'Miten se toimii', 'nav_pricing': 'Hinnasto', 'nav_useful': 'Hyödyllistä tietoa', 'nav_cta': 'Hanki pääsy',
    'nav_tech': 'Teknologia', 'nav_process': 'Prosessi', 'nav_events': 'Tapahtumat', 'nav_friends': 'Ystävät', 'nav_logout': 'Kirjaudu ulos', 'nav_login': 'Kirjaudu sisään',
    'layer_opacity': 'Tason läpinäkyvyys', 'layer_satellite': 'Satelliitti', 'layer_sat_period_label': 'Historiallinen', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Paikat', 'layer_uat': 'Hallinnolliset rajat', 'layer_heritage': 'Perintö', 'layer_heritage_group': 'Perintö ja kulttuuri',
    'layer_historical': 'Historialliset kartat', 'layer_historical_premium': 'Historialliset kartat', 'layer_historical_eu': 'Eurooppalaiset historialliset kartat (CENAGIS / IH PAN)',
    'layer_vegfp_group': 'Kasvillisuussormenjälki', 'layer_vegfp_ppi': 'PPI (Kasvien fenologiaindeksi)', 'layer_vegfp_smx': 'SMX (Kauden huippuarvo)',
    'layer_vegfp_sgu': 'SGU (Kauden vihertymisnopeus)', 'layer_vegfp_sgd': 'SGD (Kauden lakastumisnopeus)',
    'layer_vegfp_date_label': 'Päivämäärä', 'layer_vegfp_year_label': 'Vuosi', 'layer_vegfp_prev_dekad': 'Edellinen 10 päivän jakso', 'layer_vegfp_next_dekad': 'Seuraava 10 päivän jakso',
    'layer_vegfp_prev_year': 'Edellinen vuosi', 'layer_vegfp_next_year': 'Seuraava vuosi', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Rooman valtakunta', 'layer_archeo_potential': 'Arkeologiset potentiaalivyöhykkeet', 'layer_battles': 'Taistelut'
})

EL = dict(EN)
EL.update({
    'nav_apm': 'Τι είναι το APM', 'nav_map': 'Εξερεύνηση χάρτη', 'nav_how': 'Πώς λειτουργεί', 'nav_pricing': 'Τιμές', 'nav_useful': 'Χρήσιμες πληροφορίες', 'nav_cta': 'Απόκτηση πρόσβασης',
    'layer_opacity': 'Διαφάνεια επιπέδου', 'layer_satellite': 'Δορυφόρος', 'layer_sat_period_label': 'Ιστορικός', 'layer_sat_period_present': '2025',
    'layer_historical': 'Ιστορικοί χάρτες', 'layer_historical_eu': 'Ευρωπαϊκοί ιστορικοί χάρτες (CENAGIS / IH PAN)',
    'layer_vegfp_group': 'Αποτύπωμα βλάστησης', 'layer_vegfp_ppi': 'PPI (Δείκτης φαινολογίας φυτών)', 'layer_vegfp_smx': 'SMX (Εποχιακή μέγιστη τιμή)',
    'layer_vegfp_sgu': 'SGU (Ρυθμός εποχιακής βλάστησης)', 'layer_vegfp_sgd': 'SGD (Ρυθμός εποχιακής γήρανσης φύλλων)',
    'layer_vegfp_date_label': 'Ημερομηνία', 'layer_vegfp_year_label': 'Έτος', 'layer_vegfp_prev_dekad': 'Προηγούμενη δεκαήμερη περίοδος', 'layer_vegfp_next_dekad': 'Επόμενη δεκαήμερη περίοδος',
    'layer_vegfp_prev_year': 'Προηγούμενο έτος', 'layer_vegfp_next_year': 'Επόμενο έτος', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Ρωμαϊκή Αυτοκρατορία', 'layer_archeo_potential': 'Ζώνες αρχαιολογικού δυναμικού', 'layer_battles': 'Μάχες'
})

LT = dict(EN)
LT.update({
    'nav_apm': 'Kas yra APM', 'nav_map': 'Tyrinėti žemėlapį', 'nav_how': 'Kaip tai veikia', 'nav_pricing': 'Kainos', 'nav_useful': 'Naudinga informacija', 'nav_cta': 'Gauti prieigą',
    'nav_tech': 'Technologija', 'nav_process': 'Procesas', 'nav_events': 'Renginiai', 'nav_friends': 'Draugai', 'nav_logout': 'Atsijungti', 'nav_login': 'Prisijungti',
    'layer_opacity': 'Sluoksnio nepermatomumas', 'layer_satellite': 'Palydovas', 'layer_sat_period_label': 'Istorinis', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Vietovės', 'layer_uat': 'Administracinės ribos', 'layer_heritage': 'Paveldas', 'layer_heritage_group': 'Paveldas ir kultūra',
    'layer_historical': 'Istoriniai žemėlapiai', 'layer_historical_premium': 'Istoriniai žemėlapiai', 'layer_historical_eu': 'Europos istoriniai žemėlapiai (CENAGIS / IH PAN)',
    'layer_vegfp_group': 'Augalijos atspaudas', 'layer_vegfp_ppi': 'PPI (Augalų fenologijos indeksas)', 'layer_vegfp_smx': 'SMX (Sezono maksimumas)',
    'layer_vegfp_sgu': 'SGU (Sezono sužaliavimo sparta)', 'layer_vegfp_sgd': 'SGD (Sezono nuvytimo sparta)',
    'layer_vegfp_date_label': 'Data', 'layer_vegfp_year_label': 'Metai', 'layer_vegfp_prev_dekad': 'Ankstesnė dekada', 'layer_vegfp_next_dekad': 'Kita dekada',
    'layer_vegfp_prev_year': 'Ankstesni metai', 'layer_vegfp_next_year': 'Kiti metai', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Romos imperija', 'layer_archeo_potential': 'Archeologinio potencialo zonos', 'layer_battles': 'Mūšiai'
})

LV = dict(EN)
LV.update({
    'nav_apm': 'Kas ir APM', 'nav_map': 'Pētīt karti', 'nav_how': 'Kā tas darbojas', 'nav_pricing': 'Cenas', 'nav_useful': 'Noderīga informācija', 'nav_cta': 'Iegūt piekļuvi',
    'nav_tech': 'Tehnoloģija', 'nav_process': 'Process', 'nav_events': 'Notikumi', 'nav_friends': 'Draugi', 'nav_logout': 'Izrakstīties', 'nav_login': 'Pieslēgties',
    'layer_opacity': 'Slāņa caurspīdīgums', 'layer_satellite': 'Satelīts', 'layer_sat_period_label': 'Vēsturisks', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Vietas', 'layer_uat': 'Administratīvās robežas', 'layer_heritage': 'Mantojums', 'layer_heritage_group': 'Mantojums un kultūra',
    'layer_historical': 'Vēsturiskās kartes', 'layer_historical_premium': 'Vēsturiskās kartes', 'layer_historical_eu': 'Eiropas vēsturiskās kartes (CENAGIS / IH PAN)',
    'layer_vegfp_group': 'Augu valsts nospiedums', 'layer_vegfp_ppi': 'PPI (Augu fenoloģijas indekss)', 'layer_vegfp_smx': 'SMX (Sezonas maksimums)',
    'layer_vegfp_sgu': 'SGU (Sezonas sazaļošanas ātrums)', 'layer_vegfp_sgd': 'SGD (Sezonas novīšanas ātrums)',
    'layer_vegfp_date_label': 'Datums', 'layer_vegfp_year_label': 'Gads', 'layer_vegfp_prev_dekad': 'Iepriekšējā dekāde', 'layer_vegfp_next_dekad': 'Nākamā dekāde',
    'layer_vegfp_prev_year': 'Iepriekšējais gads', 'layer_vegfp_next_year': 'Nākamais gads', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Romas impērija', 'layer_archeo_potential': 'Arheoloģiskā potenciāla zonas', 'layer_battles': 'Kaujas'
})

ET = dict(EN)
ET.update({
    'nav_apm': 'Mis on APM', 'nav_map': 'Uuri kaarti', 'nav_how': 'Kuidas see töötab', 'nav_pricing': 'Hinnakiri', 'nav_useful': 'Kasulik teave', 'nav_cta': 'Hangi ligipääs',
    'nav_tech': 'Tehnoloogia', 'nav_process': 'Protsess', 'nav_events': 'Sündmused', 'nav_friends': 'Sõbrad', 'nav_logout': 'Logi välja', 'nav_login': 'Logi sisse',
    'layer_opacity': 'Kihi läbipaistvus', 'layer_satellite': 'Satelliit', 'layer_sat_period_label': 'Ajalooline', 'layer_sat_period_present': '2025',
    'layer_osm_places': 'OSM Kohad', 'layer_uat': 'Halduspiirid', 'layer_heritage': 'Pärand', 'layer_heritage_group': 'Pärand ja kultuur',
    'layer_historical': 'Ajaloolised kaardid', 'layer_historical_premium': 'Ajaloolised kaardid', 'layer_historical_eu': 'Euroopa ajaloolised kaardid (CENAGIS / IH PAN)',
    'layer_vegfp_group': 'Taimestiku sõrmejälg', 'layer_vegfp_ppi': 'PPI (Taimefenoloogia indeks)', 'layer_vegfp_smx': 'SMX (Hooaja maksimum)',
    'layer_vegfp_sgu': 'SGU (Hooaja haljastumise kiirus)', 'layer_vegfp_sgd': 'SGD (Hooaja närbumiskiirus)',
    'layer_vegfp_date_label': 'Kuupäev', 'layer_vegfp_year_label': 'Aasta', 'layer_vegfp_prev_dekad': 'Eelmine 10-päevane periood', 'layer_vegfp_next_dekad': 'Järgmine 10-päevane periood',
    'layer_vegfp_prev_year': 'Eelmine aasta', 'layer_vegfp_next_year': 'Järgmine aasta', 'layer_vegfp_ro_note': 'Tiles are fetched only for Romania',
    'layer_roman': 'Rooma impeerium', 'layer_archeo_potential': 'Arheoloogilise potentsiaali tsoonid', 'layer_battles': 'Lahingud'
})

ALL_LANGS = {
    'en': EN, 'ro': RO, 'de': DE, 'fr': FR, 'it': IT, 'es': ES,
    'pl': PL, 'uk': UK, 'hu': HU, 'cs': CS, 'sk': SK, 'nl': NL,
    'pt': PT, 'ru': RU, 'bg': BG, 'hr': HR, 'sr': HR, 'el': EL,
    'da': DA, 'sv': SV, 'no': NO, 'fi': FI, 'lt': LT, 'lv': LV, 'et': ET
}

print(f"Total languages prepared: {len(ALL_LANGS)}")

# Write to js/translations.js
# Read the template/original translations.js file to preserve comments and helper functions
with open('js/translations.js', 'r', encoding='utf-8') as f:
    orig = f.read()

# Replace the translations object
trans_json_parts = []
for l_code, l_dict in ALL_LANGS.items():
    entries = []
    # Ensure arch_report_apm_class_4.5 is present
    if 'arch_report_apm_class_4.5' not in l_dict:
        if l_code == 'ro':
            l_dict['arch_report_apm_class_4.5'] = 'verde — scor 4.5 (potențial ridicat)'
        else:
            l_dict['arch_report_apm_class_4.5'] = 'green — score 4.5 (high potential)'
            
    handled = set()
    for k, v in l_dict.items():
        if k in handled:
            continue
        if k == 'nav_tech' and 'nav_process' in l_dict:
            v_tech = v.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
            v_proc = l_dict['nav_process'].replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
            entries.append(f"                nav_tech: '{v_tech}', nav_process: '{v_proc}'")
            handled.add('nav_tech')
            handled.add('nav_process')
            continue
        if k == 'nav_process' and 'nav_tech' in handled:
            continue

        # Escape quotes safely for single-quoted JS strings
        escaped_v = v.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '')
        if '.' in k or (l_code not in ['en', 'ro'] and k == 'perf_layers_notice'):
            entries.append(f"                '{k}': '{escaped_v}'")
        else:
            entries.append(f"                {k}: '{escaped_v}'")
    block = f"            {l_code}: {{\n" + ",\n".join(entries) + "\n            }"
    trans_json_parts.append(block)

all_trans_str = "        const translations = {\n" + ",\n".join(trans_json_parts) + "\n        };"

# Find boundaries in orig
start_idx = orig.find('const translations = {')
end_idx = orig.find('const LANGUAGE_STORAGE_KEY =')

if start_idx != -1 and end_idx != -1:
    new_code = orig[:start_idx] + all_trans_str + "\n\n        " + orig[end_idx:]
    with open('js/translations.js', 'w', encoding='utf-8') as f:
        f.write(new_code)
    print("Successfully updated js/translations.js with all European languages!")
else:
    print("Could not find translation object boundaries.")
