# The SoftwareX manuscript.
#
#   make        build the PDF
#   make data   regenerate every figure dataset from the software itself
#   make clean
#
# `make data` is not a prerequisite of the PDF on purpose: the datasets are
# committed, so the paper builds without Node, and regenerating them is a
# deliberate act.

TEX  = pdflatex -interaction=nonstopmode -halt-on-error
MAIN = softwarex

all: $(MAIN).pdf

$(MAIN).pdf: $(MAIN).tex refs.bib figures/poleni.tex figures/family.tex \
             figures/band.tex
	$(TEX) $(MAIN)
	-bibtex $(MAIN)
	$(TEX) $(MAIN)
	$(TEX) $(MAIN)
	@echo
	@grep -c "Overfull" $(MAIN).log | xargs -I{} echo "overfull boxes: {}"

data:
	node figures/makedata.js
	node figures/makeexample.js Poleni_Example_01

clean:
	rm -f $(MAIN).aux $(MAIN).bbl $(MAIN).blg $(MAIN).log $(MAIN).out \
	      $(MAIN).spl $(MAIN).fdb_latexmk

.PHONY: all data clean
