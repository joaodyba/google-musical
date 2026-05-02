import re

def get_first_artist(artist):
    splitters = ['Featuring', '&', 'feat.', ',']
    for splitter in splitters:
        if splitter in artist:
            return artist.split(splitter)[0].strip()
    return artist.strip()


print(get_first_artist("Drake Featuring Future & Young Thug"))  # Saída: Drake
print(get_first_artist("The Kid LAROI & Justin Bieber"))        # Saída: The Kid LAROI
print(get_first_artist("Lil Nas X, Jack Harlow"))               # Saída: Lil Nas X
