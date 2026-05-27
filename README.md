# aLOTofImaginArches

aLOTofImagineArches is an educational software that allows for interactive demonstrations that involve the user in experimentation with the funicular solution concept. The tool is designed for the master students of the courses MHMS and HMWS and is mainly useful to capture the idea of ∞³ funicular solutions for masonry arches.

|<img src="https://github.com/gcastellazzi/aLOTofImaginArches/blob/main/Examples/aLOT.png" alt="Logo aLOTofImagineArches" title="Logo aLOTofImagineArches" width="300"/>|

## Rationale

Over the years, I have greatly benefited from various open-source projects, and in turn, I have shared the libraries and toolkits I developed with the broader community. Open source works!

This page serves as an educational resource for undergraduate and graduate civil engineering students. Here, you will find a Matlab software toolkit called aLOTofImaginArches.

The software is available as open-source.

By sharing these resources, I hope to gather feedback and suggestions that will improve their usefulness for everyone.

|![The study of Giovanni Poleni about S. Peter Dome](https://github.com/gcastellazzi/aLOTofImaginArches/blob/main/Examples/Example_Poleni.png "The study of Giovanni Poleni about S. Peter Dome")|

## aLOTofImagineArches Software

|![Interactive funicular analysis using aLOTofImagineArches](https://github.com/gcastellazzi/aLOTofImaginArches/blob/main/Examples/Example_Funicular.png "Interactive funicular analysis using aLOTofImagineArches")|

|![The study of Giovanni Poleni about S. Peter Dome](https://github.com/gcastellazzi/aLOTofImaginArches/blob/main/Examples/Example_Funicular_Poleni.png "The study of Giovanni Poleni about S. Peter Dome")|

## Documentation

Several examples are already available in the `Examples/` folder.

**Web user guide (English):** after enabling GitHub Pages on the `main` branch / `/docs` folder, the guide is published at  
[https://gcastellazzi.github.io/aLOTofImaginArches/](https://gcastellazzi.github.io/aLOTofImaginArches/)  
(source: [`docs/index.html`](docs/index.html)).

Step-by-step PDF tutorials:

- [Loads, graphics & units](Docs/Load_Graphics_Units.pdf)
- [Circular arch construction](Docs/Example_Circular_arch_construction.pdf)
- [Sketched arch construction](Docs/Example_Sketched_arch_construction.pdf)

## Latest Developments

The latest updates to the aLOTofImaginArches software include:

- **Force and Weight Handling:**
  - Integrated visualization for forces (`Blocks_like_kind == 1`) using arrows with magnitude and direction.
  - Added block weight representation (`Blocks_like_kind == 0`) using downward arrows at block centroids.
  - Improved labeling for forces and weights with LaTeX-style formatting.

- **Arrow Plotting and Block Display Enhancements:**
  - Enhanced `drawArrow` function:
    - Arrowhead size remains constant regardless of arrow length.
    - Shaft length scales proportionally while maintaining a fixed thickness.
    - Improved logic for short arrows to prevent overlapping of shaft and head.
  - Improved block plotting functionality:
    - Blocks are now displayed with random light brick colors for better visualization.
    - Enhanced labeling with LaTeX-style text for clarity and formatted numeric values with two decimal precision.

These updates improve the visualization of forces, weights, and block interactions, enhancing the tool's educational value and usability.

## Python port

The Python desktop application **pyLOT** is developed separately in the sibling folder [`../pyLOT`](../pyLOT) (same parent directory as this repository). It reuses the `.mat` examples from [`Examples/`](Examples/).

## Future developments

- Mechanism detection using LOT
- Fiber-reinforced enhancement
