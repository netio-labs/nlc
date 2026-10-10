CC      ?= gcc
CFLAGS  ?= -O2 -Wall -Wextra
TARGET   = ioulive86
SRCS     = ioulive.c iou-raw.c parse.c l4csum.c
INSTALL_DIR = ../../iou

all: $(TARGET)

$(TARGET): $(SRCS) ioulive.h iou-raw.h l4csum.h
	$(CC) $(CFLAGS) -o $@ $(SRCS)

install: $(TARGET)
	install -m 0755 $(TARGET) $(INSTALL_DIR)/$(TARGET)

clean:
	rm -f $(TARGET)
