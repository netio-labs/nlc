CC      ?= gcc
CFLAGS  ?= -O2 -Wall -Wextra
SRC      = wrapper-linux.c
EXE      = wrapper-linux
INSTALL_DIR = ../../iou

all: $(EXE)

$(EXE): $(SRC)
	$(CC) $(CFLAGS) -o $(EXE) $(SRC)

install: $(EXE)
	install -m 0755 $(EXE) $(INSTALL_DIR)/$(EXE)

.PHONY: all install clean

clean:
	rm -f $(EXE)
