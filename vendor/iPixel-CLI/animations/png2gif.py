import os
from PIL import Image

def png_to_gif(input_folder, output_file, duration=100, loop=0):
    """
    Convertit une séquence d'images PNG en un GIF animé.

    :param input_folder: Dossier contenant les images PNG
    :param output_file: Nom du fichier de sortie GIF
    :param duration: Durée de chaque image en millisecondes (100ms par défaut)
    :param loop: Nombre de boucles (0 pour une boucle infinie)
    """
    # Liste toutes les images PNG dans le dossier
    images = [f for f in os.listdir(input_folder) if f.endswith(".png")]
    
    if not images:
        print("Aucune image PNG trouvée dans le dossier.")
        return

    # Trie les images par nom (utile si elles sont numérotées)
    images.sort()

    # Charge les images avec Pillow
    frames = [Image.open(os.path.join(input_folder, img)) for img in images]

    # Sauvegarde en GIF animé
    frames[0].save(
        output_file,
        format='GIF',
        save_all=True,
        append_images=frames[1:],
        duration=duration,
        loop=loop
    )
    print(f"GIF créé avec succès : {output_file}")

if __name__ == "__main__":
    # Paramètres
    input_folder = "input_images"  # Remplace par ton dossier d'entrée
    output_file = "output_animation.gif"  # Nom du fichier GIF
    duration = 500  # Durée de chaque image (en ms)
    loop = 0  # Boucle infinie

    # Création du GIF
    png_to_gif(input_folder, output_file, duration, loop)
