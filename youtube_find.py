import json
import requests
import time
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher # For flexible string comparison

from pydub import AudioSegment
# pydub.playback.play is commented out as it's not needed for just saving.
# from pydub.playback import play 

# --- File Paths ---
INPUT_JSON_FILE = 'songs.json'
OUTPUT_JSON_FILE = 'songs_enriched_deezer.json'
TEMP_OUTPUT_FILE = 'songs_enriched_deezer.temp.json'

# --- Deezer API Endpoint ---
DEEZER_SEARCH_URL = 'https://api.deezer.com/search/track'

# --- Concurrency & Retry Settings ---
MAX_WORKERS = 3 # This controls how many searches run at the same time.
                # Lowering this makes the script run slower but more stably.
INITIAL_RETRY_DELAY = 1 # Seconds to wait before first retry
MAX_RETRIES = 3 # Maximum number of retries for a single API call
RATE_LIMIT_DELAY = 7 # Seconds to wait if a 429 Too Many Requests errors is encountered.
API_CALL_DELAY = 0.5 # Seconds to wait between each individual API call (proactive delay)

# --- Matching Thresholds ---
# How similar do strings need to be (0.0 to 1.0)
TITLE_SIMILARITY_THRESHOLD = 0.80 # Song title must be at least 80% similar
ARTIST_SIMILARITY_THRESHOLD = 0.75 # Artist name must be at least 75% similar

# --- Saving Settings ---
SAVE_FREQUENCY_COUNT = 50 # Save the JSON file after every N songs are processed

# --- Audio Trimming Settings ---
OUTPUT_AUDIO_DIR = 'trimmed_previews' # Directory to save the trimmed audio files
MAX_AUDIO_LENGTH_MS = 5000 # Maximum length for the audio snippet in milliseconds (5 seconds = 5000 ms)


def clean_string(text):
    """
    Clean string for comparison: lowercase, remove non-alphanumeric except spaces,
    remove common song version suffixes, and normalize compound title separators.
    """
    if not isinstance(text, str):
        return ""
    text = text.lower()
    
    # Define patterns for common version/mix indicators and feature artists in titles.
    # Order is important: more specific patterns should come first.
    version_patterns = [
        r'\s*\(radio\s*edit\)', r'\s*\[radio\s*edit\]',
        r'\s*\(live\)', r'\s*\[live\]',
        r'\s*\(remix\)', r'\s*\[remix\]', r'\s*\(.*remix\)', r'\s*\[.*remix\]',
        r'\s*\(acoustic\)', r'\s*\[acoustic\]',
        r'\s*\(instrumental\)', r'\s*\[instrumental\]',
        r'\s*\(extended\s*mix\)', r'\s*\[extended\s*mix\]',
        r'\s*\(original\s*mix\)', r'\s*\[original\s*mix\]',
        r'\s*\(album\s*version\)', r'\s*\[album\s*version\]',
        r'\s*\(single\s*version\)', r'\s*\[single\s*version\]',
        r'\s*\(clean\)', r'\s*\[clean\]',
        r'\s*\(explicit\)', r'\s*\[explicit\]',
        r'\s*\(feat\.\s*[^)]+\)', r'\s*\[feat\.\s*[^\]]+\]', # (feat. Artist)
        r'\s*\(ft\.\s*[^)]+\)', r'\s*\[ft\.\s*[^\]]+\]',     # (ft. Artist)
        r'\s*\(featuring\s*[^)]+\)', r'\s*\[featuring\s*[^\]]+\]', # (featuring Artist)
        r'\s*\(with\s*[^)]+\)', r'\s*\[with\s*[^\]]+\]',     # (with Artist)
        r'\s*-\s*(?:radio\s*edit|live|remix|acoustic|instrumental|extended\s*mix|original\s*mix|album\s*version|single\s*version|clean|explicit|feat\.|ft\.|featuring|with).*', # Content after a hyphen for common versions
        r'\s*\(.*\)', r'\s*\[.*\]', # General parenthetical/bracketed content if not already caught
        r'\s*-\s*.*' # General content after a hyphen (e.g., "Song - Other Info")
    ]
    
    for pattern in version_patterns:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE).strip() # Use IGNORECASE flag
    
    # NEW: Normalize compound title separators for better comparison
    # Replace common separators with a space or remove them
    text = re.sub(r'\s*[/\&]\s*', ' ', text) # Replace slash/ampersand with space
    text = re.sub(r'\s+and\s+', ' ', text) # Replace ' and ' with space
    text = re.sub(r'\s*,\s*', ' ', text) # Replace comma with space

    text = re.sub(r'[^\w\s]', '', text) # Remove punctuation and special characters *after* version stripping
    text = re.sub(r'\s+', ' ', text).strip() # Replace multiple spaces with single space
    return text

def is_similar(str1, str2, threshold):
    """Check if two strings are similar above a given threshold."""
    if not str1 or not str2:
        return False
    # Clean strings before comparison to account for variations and compound titles
    s = SequenceMatcher(None, clean_string(str1), clean_string(str2))
    return s.ratio() >= threshold

def clean_and_split_artist(artist_name):
    """
    Attempts to clean and split artist names by common 'featuring' patterns.
    Returns a list of potential artist names to search, prioritizing the main artist.
    """
    if not artist_name:
        return []

    # Patterns to identify common separators for featured artists
    patterns = [
        r'\s(?:feat\.|ft\.|featuring|with)\s',
        r'\s&\s',
        r'\s,?\s(?:and|vs\.?)\s'
    ]
    combined_pattern = '|'.join(patterns)
    
    # Split the artist name by these patterns
    initial_parts = re.split(combined_pattern, artist_name, flags=re.IGNORECASE)
    cleaned_parts = [part.strip() for part in initial_parts if part.strip()]
    
    artist_variations = []

    # If splitting resulted in parts, the first part is usually the main artist. Prioritize it.
    if cleaned_parts:
        main_artist = cleaned_parts[0]
        artist_variations.append(main_artist) 
    
    # Always include the original full artist name
    if artist_name.strip() not in artist_variations:
        artist_variations.append(artist_name.strip())

    # Add any other parts (e.g., featured artists like "Lauren Bennett", "GoonRock")
    for i in range(1, len(cleaned_parts)):
        if cleaned_parts[i] not in artist_variations:
            artist_variations.append(cleaned_parts[i])
            
    return artist_variations

def clean_and_split_title(song_title):
    """
    Attempts to clean and split compound song titles by common "and/or" patterns.
    Returns a list of potential title names to search, prioritizing simpler forms.
    """
    if not song_title:
        return []

    # Patterns to identify compound titles (e.g., "Song1 / Song2", "Song1 & Song2", "Song1 and Song2")
    patterns = [
        r'\s*/\s*',      # For "Song1 / Song2"
        r'\s*&\s*',      # For "Song1 & Song2"
        r'\s+and\s+',    # For "Song1 and Song2"
        r'\s*,\s*',      # For "Song1, Song2" (less common for split, but can happen)
    ]
    combined_pattern = '|'.join(patterns)
    
    initial_parts = re.split(combined_pattern, song_title, flags=re.IGNORECASE)
    cleaned_parts = [part.strip() for part in initial_parts if part.strip()]
    
    title_variations = []

    # Prioritize shorter parts if available, then the original
    # For "A / B", try "A", then "B", then "A / B"
    for part in cleaned_parts:
        if part not in title_variations:
            title_variations.append(part)
    
    # Always ensure the original full song title is present
    if song_title.strip() not in title_variations:
        title_variations.append(song_title.strip())
            
    return title_variations


def _make_deezer_request_with_retries(query_string, attempt=1):
    """
    Internal helper to make a single Deezer API request with retry logic.
    Returns a list of potential track results, or None if error/not found.
    """
    params = {
        'q': query_string,
        'limit': 10 # Request top 10 results to check for better matches
    }

    # Add a small delay before making the request, only on the initial attempt for a new query
    if attempt == 1: 
        time.sleep(API_CALL_DELAY)

    try:
        print(f"    Attempt {attempt}: Searching Deezer with query: '{query_string}'")
        response = requests.get(DEEZER_SEARCH_URL, params=params, timeout=15)
        response.raise_for_status() # Raises an HTTPError for bad responses (4xx or 5xx)
        results = response.json()

        if results and 'data' in results and len(results['data']) > 0:
            return results['data'], "found_potential" # Return the list of tracks
        return [], "not_found"
    except requests.exceptions.HTTPError as e:
        status_code = e.response.status_code
        print(f"    HTTP error ({status_code}) for query '{query_string}': {e.response.text}")
        if status_code == 429: # Too Many Requests
            print(f"    Rate limit hit. Waiting {RATE_LIMIT_DELAY} seconds...")
            time.sleep(RATE_LIMIT_DELAY)
            return None, "rate_limit"
        elif 400 <= status_code < 500: # Client error, likely not retriable meaningfully
            print(f"    Client error ({status_code}) for query '{query_string}'. Skipping further attempts for this query.")
            return None, "client_error"
        else: # Server error or other retriable HTTP error
            print(f"    Retrying in {INITIAL_RETRY_DELAY * (2 ** (attempt -1))} seconds...")
            time.sleep(INITIAL_RETRY_DELAY * (2 ** (attempt -1)))
            return None, "retry"
    except requests.exceptions.RequestException as e: # Network error, timeout, etc.
        print(f"    Network error for query '{query_string}': {e}")
        print(f"    Retrying in {INITIAL_RETRY_DELAY * (2 ** (attempt -1))} seconds...")
        time.sleep(INITIAL_RETRY_DELAY * (2 ** (attempt -1)))
        return None, "retry"

def download_and_trim_audio(preview_url, song_title, artist_name, max_length_ms=MAX_AUDIO_LENGTH_MS):
    """
    Downloads an audio file from a URL, trims it to a maximum length,
    and saves it to a local file.

    Args:
        preview_url (str): The URL of the audio preview (e.g., from Deezer).
        song_title (str): The title of the song (for naming the output file).
        artist_name (str): The artist name (for naming the output file).
        max_length_ms (int): The maximum length in milliseconds to trim the audio.
    
    Returns:
        str: The path to the saved trimmed audio file, or None if an error occurred.
    """
    if not preview_url:
        print(f"  Skipping audio download: No preview URL provided for '{song_title}' by '{artist_name}'.")
        return None

    # Create output directory if it doesn't exist
    if not os.path.exists(OUTPUT_AUDIO_DIR):
        os.makedirs(OUTPUT_AUDIO_DIR)
        print(f"  Created audio output directory: {OUTPUT_AUDIO_DIR}")

    # Sanitize filename to remove invalid characters
    # Replace common path separators and problematic characters with underscore
    sanitized_title = "".join(c for c in song_title if c.isalnum() or c in (' ', '.', '_', '-')).strip()
    sanitized_artist = "".join(c for c in artist_name if c.isalnum() or c in (' ', '.', '_', '-')).strip()
    # Limit length to avoid excessively long filenames
    sanitized_title = sanitized_title[:50].strip()
    sanitized_artist = sanitized_artist[:40].strip()
    
    output_filename = f"{sanitized_artist} - {sanitized_title}.mp3"
    output_filepath = os.path.join(OUTPUT_AUDIO_DIR, output_filename)

    # Check if file already exists to avoid re-downloading/re-processing
    if os.path.exists(output_filepath):
        print(f"  Skipping audio download: Trimmed audio already exists at '{output_filepath}'")
        return output_filepath

    temp_audio_path = None # Initialize outside try block for finally clause
    try:
        print(f"  Downloading preview for '{song_title}' by '{artist_name}' from: {preview_url}")
        # Download the audio content
        response = requests.get(preview_url, stream=True, timeout=20) # Increased timeout for download
        response.raise_for_status() # Raise an exception for bad status codes

        # Save the raw audio to a temporary file
        temp_audio_path = os.path.join(OUTPUT_AUDIO_DIR, f"temp_{os.urandom(8).hex()}.mp3")
        with open(temp_audio_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"  Downloaded temporary audio file: {temp_audio_path}")

        # Load the audio segment using pydub
        audio = AudioSegment.from_mp3(temp_audio_path)
        print(f"  Original audio length: {len(audio)} ms")

        # Trim the audio if it's longer than max_length_ms
        if len(audio) > max_length_ms:
            trimmed_audio = audio[:max_length_ms]
            print(f"  Trimmed audio to {len(trimmed_audio)} ms")
        else:
            trimmed_audio = audio
            print(f"  Audio is already {len(trimmed_audio)} ms (no trimming needed)")

        # Export the trimmed audio to the final MP3 file
        trimmed_audio.export(output_filepath, format="mp3")
        print(f"  Successfully saved trimmed audio to: '{output_filepath}'")

        return output_filepath

    except requests.exceptions.RequestException as e:
        print(f"  Error downloading '{song_title}' preview (network/HTTP issue): {e}")
    except FileNotFoundError:
        print(f"  Error: FFmpeg or Libav not found. Please install FFmpeg and ensure it's in your system PATH.")
    except Exception as e:
        print(f"  An unexpected error occurred while processing audio for '{song_title}': {e}")
    finally:
        # Ensure temporary file is removed even if other errors occur
        if temp_audio_path and os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
            print(f"  Cleaned up temporary file: {temp_audio_path}")
    return None

def search_deezer_track_and_process_audio_robust(original_artist, song_title):
    """
    Searches Deezer for a track with robust logic, and if found,
    downloads and trims the audio preview.
    Returns Deezer URL, Deezer ID, and local audio file path.
    """
    artist_names_to_try = clean_and_split_artist(original_artist)
    song_title_variations = clean_and_split_title(song_title)
    
    # Define different query strategies from most to least precise
    query_formats = [
        lambda a, s: f"artist:\"{a}\" track:\"{s}\"", # Strict: artist and track fields
        lambda a, s: f"\"{s}\" \"{a}\"",               # Quoted: exact phrase search for title and artist
        lambda a, s: f"{s} {a}"                       # Broad: general search (e.g., "Song Title Artist Name")
    ]

    deezer_url = None
    deezer_id = None
    local_audio_path = None

    for artist_to_use in artist_names_to_try:
        for title_to_use in song_title_variations:
            for query_format_func in query_formats:
                query_string = query_format_func(artist_to_use, title_to_use)
                
                for attempt in range(1, MAX_RETRIES + 1):
                    tracks_data, status = _make_deezer_request_with_retries(query_string, attempt)
                    
                    if status == "found_potential":
                        for track in tracks_data:
                            track_title = track.get('title')
                            track_artist_name = track['artist'].get('name') if 'artist' in track else None
                            preview_url = track.get('preview')
                            deezer_track_id = track.get('id')

                            # Check for similarity in both title and artist, and ensure a preview URL exists
                            if (is_similar(song_title, track_title, TITLE_SIMILARITY_THRESHOLD) and
                                is_similar(original_artist, track_artist_name, ARTIST_SIMILARITY_THRESHOLD) and
                                preview_url):
                                print(f"    SUCCESS: Found good Deezer match for '{song_title}' by '{original_artist}' with Deezer track '{track_title}' by '{track_artist_name}'.")
                                
                                # Found a match, now download and trim the audio
                                local_audio_path = download_and_trim_audio(preview_url, song_title, original_artist)
                                if local_audio_path:
                                    # Only return if local audio was successfully saved
                                    return preview_url, deezer_track_id, local_audio_path
                                else:
                                    # If download/trim failed, consider this match unsuccessful and continue search
                                    print(f"    Warning: Deezer preview found, but failed to download/trim audio for '{song_title}'. Trying next result...")
                                    continue # Try next track in the results

                        print(f"    No precise Deezer match with working preview found among top results for query: '{query_string}'. Trying next format/variation.")
                        break # Break from attempt loop, go to next query_format
                    
                    elif status == "not_found":
                        print(f"    No Deezer results found for query: '{query_string}'. Trying next format/variation.")
                        break

                    elif status == "client_error":
                        # Client error is permanent for this query, no retries needed for this specific query
                        break 
                    elif status == "rate_limit":
                        if attempt == MAX_RETRIES:
                            print(f"    Failed after multiple retries due to Deezer rate limit for query: '{query_string}'. Moving to next query/artist.")
                            break
                        continue # continue inner retry loop
                    elif status == "retry":
                        if attempt == MAX_RETRIES:
                            print(f"    Failed after multiple retries for Deezer query: '{query_string}'. Moving to next query/artist.")
                            break
                        continue # continue inner retry loop
    
    print(f"    FAILED: No Deezer preview (or audio download) found after all attempts, variations, and query formats for '{song_title}' by '{original_artist}'.")
    return None, None, None # Return None for all if no success

def enrich_songs_with_deezer_and_local_audio_concurrent(input_file, output_file, max_workers):
    """
    Reads songs, concurrently searches Deezer for preview URLs,
    downloads and trims audio, and writes the enriched data to output_file
    periodically and finally.
    """
    songs = []

    try:
        if os.path.exists(output_file):
            with open(output_file, 'r', encoding='utf-8') as f:
                songs = json.load(f)
            print(f"Resuming from existing '{output_file}' with {len(songs)} entries.")
        else:
            with open(input_file, 'r', encoding='utf-8') as f:
                songs = json.load(f)
            print(f"Starting fresh from '{input_file}' with {len(songs)} entries.")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error loading initial/existing data: {e}. Cannot proceed.")
        return

    songs_to_process = []
    for song_idx, song in enumerate(songs):
        # Process if Deezer URL or local audio path is missing/None
        if 'deezer_preview_url' not in song or song['deezer_preview_url'] is None or \
           'local_preview_path' not in song or song['local_preview_path'] is None or \
           not os.path.exists(song.get('local_preview_path', '')): # Check if file actually exists
            songs_to_process.append((song_idx, song))
        
    if not songs_to_process:
        print("All songs already have Deezer preview URLs and local audio files. No processing needed.")
        return

    total_to_process = len(songs_to_process)
    processed_count = 0
    enriched_count = 0
    processed_since_last_save = 0 # New counter for periodic saving

    print(f"Found {total_to_process} songs to process for Deezer preview URLs and local audio.")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_song_idx = {
            executor.submit(search_deezer_track_and_process_audio_robust, s[1]['artist'], s[1]['song']): s[0]
            for s in songs_to_process
        }

        for future in as_completed(future_to_song_idx):
            song_original_idx = future_to_song_idx[future]
            original_song_data = songs[song_original_idx]

            try:
                deezer_url, deezer_id, local_audio_path = future.result()
                
                original_song_data['deezer_preview_url'] = deezer_url
                original_song_data['deezer_id'] = deezer_id
                original_song_data['local_preview_path'] = local_audio_path

                if deezer_url and local_audio_path:
                    enriched_count += 1

            except Exception as exc:
                original_song_data['deezer_preview_url'] = None
                original_song_data['deezer_id'] = None
                original_song_data['local_preview_path'] = None
                print(f"Error processing song '{original_song_data['song']}' by '{original_song_data['artist']}': {exc}")
            finally:
                processed_count += 1
                processed_since_last_save += 1 # Increment new counter
                print(f"Processed {processed_count}/{total_to_process} songs.")

                # Periodically save the file
                if processed_since_last_save >= SAVE_FREQUENCY_COUNT:
                    print(f"Saving progress... ({processed_count} songs processed)")
                    try:
                        with open(TEMP_OUTPUT_FILE, 'w', encoding='utf-8') as f:
                            json.dump(songs, f, indent=4, ensure_ascii=False)
                        os.replace(TEMP_OUTPUT_FILE, output_file)
                        print(f"Progress saved to '{output_file}'.")
                        processed_since_last_save = 0 # Reset counter after saving
                    except IOError as e:
                        print(f"Error saving progress to output file '{output_file}': {e}")


    # --- Final save at the end to catch any remaining unsaved items ---
    try:
        print(f"\nAll processing complete. Saving final data to '{output_file}'...")
        with open(TEMP_OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(songs, f, indent=4, ensure_ascii=False)
        os.replace(TEMP_OUTPUT_FILE, output_file)
        print(f"Successfully enriched {enriched_count} new preview URLs and local audio files. Total songs in file: {len(songs)}.")
        print(f"Final data saved to '{output_file}'.")
    except IOError as e:
        print(f"Error writing to output file '{output_file}': {e}")


if __name__ == "__main__":
    start_time = time.time()
    # Ensure the output audio directory exists at the start
    if not os.path.exists(OUTPUT_AUDIO_DIR):
        os.makedirs(OUTPUT_AUDIO_DIR)
        print(f"Created main audio directory: {OUTPUT_AUDIO_DIR}")

    enrich_songs_with_deezer_and_local_audio_concurrent(INPUT_JSON_FILE, OUTPUT_JSON_FILE, MAX_WORKERS)
    end_time = time.time()
    print(f"Script finished in {end_time - start_time:.2f} seconds.")
