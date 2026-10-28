# 03: Generated neurons as mocks and stand-ins

Generated neurons have been used in four ways in published work. Each one
puts a different demand on the generator.

## 1. Stand-ins inside simulated circuits

**Kanari et al. 2022 (Cell Reports) and the 2024 axon preprint.**
[doi](https://doi.org/10.1016/j.celrep.2022.110586) ·
[bioRxiv](https://www.biorxiv.org/content/10.1101/2024.10.04.616605.full.pdf)
- Synthesised dendrites were statistically similar to reconstructions on
  morphology, single-cell electrical behaviour and network connectivity.
- That allowed whole rodent cortical regions to be built from a few
  reference cells.
- Synthesised axons also matched morphology, topology and targeting.
- What the evidence shows is *statistical equivalence*. Nothing showed that
  swapping all reconstructions for synthetic cells left circuit-level results
  unchanged.

*Demand on the generator:* match the population statistics, not individual
cells. This is the v1 validation standard.

## 2. The generated cell *is* the experiment

**Pissadaki & Bolam 2013.** [PMC3600574](https://pmc.ncbi.nlm.nih.gov/articles/PMC3600574/)
- Rule-generated binary-tree arbors were varied in size to test a
  hypothesis: energy cost against arbor size.
- No real cell could be varied that way.

**Le Masson et al. 2014.** A generic NEURON cell, lengthened and re-pumped
into a motor neuron, to ask how morphology changes ATP vulnerability.

*Demand on the generator:* controllable parameters with known biological
meaning. This is why v1 parameters are measurable statistics, not latent
codes.

## 3. Labelled training and benchmark data for image tools

- **Two-stage generative models (IEEE TMI 2022).** Realistic 3D neuron
  images with built-in voxel labels. Segmentation nets trained on them
  matched or beat nets trained on manual labels.
  [review context, PMC9750132](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9750132/)
- **Skeleton-to-image cGAN (ISBI 2020).** Simulated skeletons in, microscopy-like
  stacks out. Adding them improved segmentation on BigNeuron Janelia-Fly data.
  [IEEE TV](https://ieeetv.ieee.org/ondemand/ieee-isbi-2020-virtual-conference-april-2020/2832)
- **Multi-scale stochastic generation (MIDL 2024).** Diverse high-resolution
  images with artefacts and background, from single-neuron tractograms.
  [MLAnthology](https://mlanthology.org/midl/2024/decroocq2024midl-multiscale)

*Demand on the generator:* exact ground-truth skeletons. Image realism is a
separate step. v1 writes SWC with per-bouton labels, which is the input these
pipelines start from. Image synthesis is out of scope.

## 4. Synthetic patients and "digital twins"

- **LLM-generated synthetic PD patients for in-silico trials.** A medRxiv
  2026 preprint, not peer reviewed. It works at patient level, not neuron
  level.
- **No published "dopaminergic neuron digital twin" for drug screening was
  found.** The closest are single-cell SNc models (Muddapu 2021, Rumbell &
  Kozloski 2019). Rumbell & Kozloski's 727 parameter sets for one toy
  morphology are a *population of models* approach
  ([PMC6776370](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6776370/)).

*Demand on the generator:* variability that reflects real biological
variability. v1 gets this by sampling morphology and bouton parameters from
human data, then reporting distributions, not single numbers.

## What follows for this project

The defensible claims for a generated cell are:
1. its population statistics match held-out real cells (use 1);
2. it is a controlled object for asking "what if" (use 2);
3. it is exact ground truth (use 3).

The claim to avoid is "this is a patient's neuron".
