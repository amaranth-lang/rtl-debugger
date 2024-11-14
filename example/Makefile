YOSYS    ?= ../../yosys/yosys

CXXFLAGS  = -Wno-array-bounds -Wno-shift-count-overflow
CXXFLAGS += -I$(dir $(YOSYS))/backends/cxxrtl/runtime/
CXXFLAGS += -g -O0
CXXFLAGS += -DCXXRTL_SERVER_TRACE

design_sim: design_sim.cc design.cc
	clang++ $(CXXFLAGS) -o $@ $(abspath $^)

design.h: design.cc
design.cc: design.v
	$(YOSYS) -q $(abspath $^) -p hierarchy -p 'write_cxxrtl -header $@'

clean:
	rm -f *.o design.cc design.h design_sim
