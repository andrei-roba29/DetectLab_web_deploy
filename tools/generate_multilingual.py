#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import re

with open('tools/en.json', 'r', encoding='utf-8') as f:
    EN = json.load(f)

with open('tools/ro.json', 'r', encoding='utf-8') as f:
    RO = json.load(f)

# Translation definitions for all European languages
# We define translations for key terms and phrases across all domains:
# - Layers & Historical Maps
# - LIDAR sublayers
# - Vegetation Fingerprint (CLMS HR-VPP)
# - Roman Empire & DARE
# - Battles & Centuries
# - Archaeological Potential & Report
# - PWA & UI & Navigation & Buttons

LANG_DATA = {
    'de': {
        'nav_apm': 'Was ist APM', 'nav_map': 'Karte erkunden', 'nav_how': 'Wie es funktioniert', 'nav_pricing': 'Preise', 'nav_useful': 'Nützliche Informationen', 'nav_cta': 'Zugang erhalten',
        'nav_tech': 'Technologie', 'nav_process': 'Prozess', 'nav_events': 'Ereignisse', 'nav_friends': 'Freunde', 'nav_logout': 'Abmelden', 'nav_login': 'Anmelden',
        'manage_account': 'Konto verwalten', 'menu_language': 'Sprache', 'menu_storage': 'Speicher',
        'hero_badge': 'Archäologie × Künstliche Intelligenz', 'hero_tagline': 'Gemeinsam Geschichte bewahren',
        'hero_btn1': '🗺 Karte erkunden', 'hero_btn2': 'Mitgliedschaftspläne anzeigen', 'scroll': 'Scrollen zum Entdecken',
        'what_label': 'Technologie', 'what_title': 'Was ist ein <span class="hl">Archäologisches Vorhersagemodell</span>?',
        'tab_free': '🔓 Kostenlose Vorschau', 'tab_member:': '🔐 Mitgliederkarte', 'tab_member': '🔐 Mitgliederkarte',
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
    },
    'fr': {
        'nav_apm': 'Qu\'est-ce que l\'APM', 'nav_map': 'Explorer la carte', 'nav_how': 'Comment ça marche', 'nav_pricing': 'Tarifs', 'nav_useful': 'Informations utiles', 'nav_cta': 'Obtenir l\'accès',
        'nav_tech': 'Technologie', 'nav_process': 'Processus', 'nav_events': 'Événements', 'nav_friends': 'Amis', 'nav_logout': 'Déconnexion', 'nav_login': 'Connexion',
        'manage_account': 'Gérer le compte', 'menu_language': 'Langue', 'menu_storage': 'Stockage',
        'hero_badge': 'Archéologie × Intelligence Artificielle', 'hero_tagline': 'Sauvegarder l\'histoire ensemble',
        'hero_btn1': '🗺 Explorer la carte', 'hero_btn2': 'Voir les abonnements', 'scroll': 'Faire défiler pour découvrir',
        'what_label': 'Technologie', 'what_title': 'Qu\'est-ce qu\'un <span class="hl">Modèle de Prédiction Archéologique</span>?',
        'tab_free': '🔓 Aperçu gratuit', 'tab_member:': '🔐 Carte abonnés', 'tab_member': '🔐 Carte abonnés',
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
    },
    'it': {
        'nav_apm': 'Cos\'è l\'APM', 'nav_map': 'Esplora la mappa', 'nav_how': 'Come funziona', 'nav_pricing': 'Prezzi', 'nav_useful': 'Informazioni utili', 'nav_cta': 'Ottieni accesso',
        'nav_tech': 'Tecnologia', 'nav_process': 'Processo', 'nav_events': 'Eventi', 'nav_friends': 'Amici', 'nav_logout': 'Disconnetti', 'nav_login': 'Accedi',
        'manage_account': 'Gestisci account', 'menu_language': 'Lingua', 'menu_storage': 'Archiviazione',
        'hero_badge': 'Archeologia × Intelligenza Artificiale', 'hero_tagline': 'Salviamo la storia insieme',
        'hero_btn1': '🗺 Esplora la mappa', 'hero_btn2': 'Vedi piani di abbonamento', 'scroll': 'Scorri per scoprire',
        'what_label': 'Tecnologia', 'what_title': 'Cos\'è un <span class="hl">Modello di Previsione Archeologica</span>?',
        'tab_free': '🔓 Anteprima gratuita', 'tab_member:': '🔐 Mappa membri', 'tab_member': '🔐 Mappa membri',
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
    },
    'es': {
        'nav_apm': 'Qué es el APM', 'nav_map': 'Explorar el mapa', 'nav_how': 'Cómo funciona', 'nav_pricing': 'Precios', 'nav_useful': 'Información útil', 'nav_cta': 'Obtener acceso',
        'nav_tech': 'Tecnología', 'nav_process': 'Proceso', 'nav_events': 'Eventos', 'nav_friends': 'Amigos', 'nav_logout': 'Cerrar sesión', 'nav_login': 'Iniciar sesión',
        'manage_account': 'Gestionar cuenta', 'menu_language': 'Idioma', 'menu_storage': 'Almacenamiento',
        'hero_badge': 'Arqueología × Inteligencia Artificial', 'hero_tagline': 'Salvando la historia juntos',
        'hero_btn1': '🗺 Explorar el mapa', 'hero_btn2': 'Ver planes de membresía', 'scroll': 'Desplazarse para descubrir',
        'what_label': 'Tecnología', 'what_title': '¿Qué es un <span class="hl">Modelo de Predicción Arqueológica</span>?',
        'tab_free': '🔓 Vista previa gratuita', 'tab_member:': '🔐 Mapa de miembros', 'tab_member': '🔐 Mapa de miembros',
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
    },
    'pl': {
        'nav_apm': 'Czym jest APM', 'nav_map': 'Przeglądaj mapę', 'nav_how': 'Jak to działa', 'nav_pricing': 'Cennik', 'nav_useful': 'Przydatne informacje', 'nav_cta': 'Uzyskaj dostęp',
        'nav_tech': 'Technologia', 'nav_process': 'Proces', 'nav_events': 'Wydarzenia', 'nav_friends': 'Znajomi', 'nav_logout': 'Wyloguj', 'nav_login': 'Zaloguj',
        'manage_account': 'Zarządzaj kontem', 'menu_language': 'Język', 'menu_storage': 'Pamięć',
        'hero_badge': 'Archeologia × Sztuczna Inteligencja', 'hero_tagline': 'Razem chronimy historię',
        'hero_btn1': '🗺 Przeglądaj mapę', 'hero_btn2': 'Zobacz plany członkostwa', 'scroll': 'Przewiń, aby odkryć',
        'what_label': 'Technologia', 'what_title': 'Czym jest <span class="hl">Archeologiczny Model Predykcyjny</span>?',
        'tab_free': '🔓 Podgląd darmowy', 'tab_member:': '🔐 Mapa członków', 'tab_member': '🔐 Mapa członków',
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
    }
}

# Create full dictionaries for all target languages by inheriting EN and overlaying translations
OUTPUT_DICTS = {}

for lang_code, specific_dict in LANG_DATA.items():
    d = dict(EN) # fallback to EN
    d.update(specific_dict)
    OUTPUT_DICTS[lang_code] = d

print(f"Generated dictionaries for: {list(OUTPUT_DICTS.keys())}")
