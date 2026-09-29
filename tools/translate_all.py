#!/usr/bin/env python3
import json
import re

with open('tools/en.json', 'r', encoding='utf-8') as f:
    en_dict = json.load(f)

with open('tools/ro.json', 'r', encoding='utf-8') as f:
    ro_dict = json.load(f)

# Core languages: DE, FR, IT, ES, PL, UK, HU, CS, SK, NL, BG, EL, PT, DA, SV, NO, FI, ET, LV, LT, HR, SR, SL

# Define vocabulary & terminology dictionaries per language for all layers, buttons, periods, finding types, analysis, and UI.

LANGUAGES = {
    'de': {'name': 'Deutsch', 'flag': '🇩🇪'},
    'fr': {'name': 'Français', 'flag': '🇫🇷'},
    'it': {'name': 'Italiano', 'flag': '🇮🇹'},
    'es': {'name': 'Español', 'flag': '🇪🇸'},
    'pl': {'name': 'Polski', 'flag': '🇵🇱'},
    'uk': {'name': 'Українська', 'flag': '🇺🇦'},
    'hu': {'name': 'Magyar', 'flag': '🇭🇺'},
    'cs': {'name': 'Čeština', 'flag': '🇨🇿'},
    'sk': {'name': 'Slovenčina', 'flag': '🇸🇰'},
    'nl': {'name': 'Nederlands', 'flag': '🇳🇱'},
    'bg': {'name': 'Български', 'flag': '🇧🇬'},
    'el': {'name': 'Ελληνικά', 'flag': '🇬🇷'},
    'pt': {'name': 'Português', 'flag': '🇵🇹'},
    'da': {'name': 'Dansk', 'flag': '🇩🇰'},
    'sv': {'name': 'Svenska', 'flag': '🇸🇪'},
    'no': {'name': 'Norsk', 'flag': '🇳🇴'},
    'fi': {'name': 'Suomi', 'flag': '🇫🇮'},
    'et': {'name': 'Eesti', 'flag': '🇪🇪'},
    'lv': {'name': 'Latviešu', 'flag': '🇱🇻'},
    'lt': {'name': 'Lietuvių', 'flag': '🇱🇹'},
    'hr': {'name': 'Hrvatski', 'flag': '🇭🇷'},
    'sr': {'name': 'Srpski', 'flag': '🇷🇸'},
    'sl': {'name': 'Slovenščina', 'flag': '🇸🇮'}
}

print(f"Preparing translations for {len(LANGUAGES)} European languages...")
