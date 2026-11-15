CXX ?= g++
CXXFLAGS ?= -std=c++20 -O2 -Wall
TARGET ?= make_app.exe

all: $(TARGET)

$(TARGET): main.cpp
	$(CXX) $(CXXFLAGS) -static -o $@ main.cpp

clean:
	rm -f $(TARGET)
