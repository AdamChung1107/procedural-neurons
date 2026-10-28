# 01: Procedural generation of neuron morphology

Approaches split into three families:
- rules that optimise a cost;
- statistical resampling of measured features;
- learned generative models.

A separate line grows neurons from simulated chemistry.

## Cost-optimisation rules

**TREES toolbox / Cuntz et al. 2010, "One rule to grow them all".**
[PMC2916857](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2916857/)
- Grows dendrites as minimum spanning trees that trade total wire length
  against conduction path length.
- One balancing factor, together with the density profile of the spanning
  field, reproduces many cell types. That factor also sets the cell's
  electrotonic compartmentalisation.
- MATLAB.

*How it helps this project:* it is a principled check. A generated cell
should not waste wire. The method needs target points, though, and
reproducing it needs MATLAB, so it is not the v1 engine.

## Topological / statistical synthesis

**NeuroTS + TMD / Kanari et al. 2022, Cell Reports, "Computational synthesis
of cortical dendritic morphologies".**
[doi:10.1016/j.celrep.2022.110586](https://doi.org/10.1016/j.celrep.2022.110586)
- Extracts a persistence barcode (Topological Morphology Descriptor) from a
  few reconstructions and grows statistically matching dendrites.
- Validated on morphology, single-cell electrophysiology and network
  connectivity.
- Used to build whole rodent cortical regions from a few reference cells.
- Python: [NeuroTS](https://neurots.readthedocs.io/),
  [TMD](https://tmd.readthedocs.io/).
- Blue Brain ended in Dec 2024. Development continues at the Open Brain
  Institute.
- A 2024 preprint extends the approach to brain-wide axons
  ([bioRxiv 2024.10.04.616605](https://www.biorxiv.org/content/10.1101/2024.10.04.616605.full.pdf)).

*How it helps this project:* it is the strongest published method and the
fallback backend if the small grower fails its validation gate. It is not the
default because it needs its input distributions extracted per cell type, its
axon synthesis is separate and newer, and it adds a stack of dependencies
(morphio, tmd, neurom).

**L-Neuron and statistical resampling (Ascoli & Krichmar 2000; Samsonovich &
Ascoli).**
- Grows trees by sampling segment length, branching probability, angles and
  taper from distributions measured on real cells, often as functions of
  branch order or path distance.

*How it helps this project:* this is the v1 approach. It is small and
transparent, and each parameter is a measurable statistic of real human cells.
It is also easy to validate against held-out cells with NeuroM.

## Learned generative models

**MorphVAE / Laturnus & Berens, ICML 2021.**
[PMLR v139](https://proceedings.mlr.press/v139/laturnus21a.html)
- A sequence-to-sequence VAE over 3D walks through the tree, with a spherical
  latent space.
- Its latent space separates cell types better than hand-picked features.
- Sampling generates new cells at a chosen distance from a reference.

**DCGAN dendrites, rodent hippocampus.**
[bioRxiv 363481](https://www.biorxiv.org/content/10.1101/363481.full.pdf)
- A GAN trained on 2D images of granule and pyramidal dendrites.
- Experts often rated its outputs as real.

*How it helps this project:* not for v1. With about 190 human L2/3 cells
these models would overfit, and their parameters are not interpretable, which
matters when the output feeds a mechanistic model.

## Growth from simulated chemistry

**Cx3D (Zubler & Douglas 2009) and its successor BioDynaMo.**
[Frontiers 2009](https://www.frontiersin.org/journals/computational-neuroscience/articles/10.3389/neuro.10.025.2009/text) ·
[BioDynaMo, arXiv 2006.06775](https://arxiv.org/pdf/2006.06775)
- Agent-based neurite growth. Direction comes from local gradients of
  diffusing factors, persistence and noise.
- One Cx3D demo has tubulin made in the soma and consumed at growth cones.
- A 2011 comparison found Cx3D networks closest to observed synapse counts.
  Their Sholl profiles were partly unrealistic.

**NETMORPH (Koene et al. 2009).** A phenomenological developmental growth
simulator of the same family.

*How it helps this project:* this is the only family where "molecular signal"
and "procedural shape" are literally the same mechanism. It suits development
questions. For a mature-neuron pathway model it is more machinery than needed.

## What this project uses

Three of these families, side by side, behind one interface
(`web/src/grow/`), each fitted to the same human cells with the same search
budget and scored on held-out cells:

- **Statistical resampling** (`fitted.js`). Section lengths, bifurcation
  probability by branch order (separately for the main lineage and side
  branches), angles and trunk counts are measured on real human MTG L2/3 cells.
  A persistent random walk carries the shape.
- **A stochastic L-system** (`lsystem.js`), in the spirit of L-Neuron.
- **Space colonization** (`colonization.js`). This is a cost-and-target
  method like TREES, but it grows toward attractor points instead of
  optimising a spanning tree.

Deep generative models were left out. About 190 cells is too few to train
them, and their parameters are not interpretable.

The output is **SWC**, the common format read by NeuroM, NEURON, MOOSE, the
NeuroMorpho viewer and Blender importers.
