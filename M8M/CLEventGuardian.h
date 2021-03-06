/*
 * This code is released under the MIT license.
 * For conditions of distribution and use, see the LICENSE or hit the web.
 */
#pragma once
#include <CL/cl.h>
#include <vector>
#include <set>
#include <condition_variable>

/*! Used to implement a clWaitForAnyEvent sort of thing. After a day thinking, I'm afraid having a thread pool is the only way to go.
In practice, I cannot find any other way to reliably wait. An approach based on clSetSetEventCallback has a major quirk: an extremely fast operation
might set an event to CL_COMPLETE even before the callback is installed. You cannot just tell Enqueue calls to set an event for you either as
    page 180 CL1.2 spec
        The function
            cl_event clCreateUserEvent (cl_context context, cl_int *errcode_ret)
        creates a user event object. User events allow applications to enqueue commands that wait on a user event to finish before the command
        is executed by the device.
Enqueue calls usually return an event and don't allow one to be set... so basically I have to watch them all. Meh. */
class CLEventGuardian {
public:
    explicit CLEventGuardian() = default;
    ~CLEventGuardian() { Shutdown(); }

    /*! Add an event to wait on, no questions asked. Keep those unique. */
    void Watch(cl_event add) {
        auto use(std::find_if(threadPool.cbegin(), threadPool.cend(), [](const std::unique_ptr<Watcher> &test) {
            std::unique_lock<std::mutex> lock(test->mutex);
            return test->watch == 0 && test->state == Watcher::s_running;
        }));
        if(use == threadPool.cend()) {
            threadPool.push_back(std::make_unique<Watcher>());
            ScopedFuncCall popErr([this]() { threadPool.pop_back(); }); // not sure if stuff below throws
            std::thread worker(AsyncWatch, std::ref(collect), threadPool.back().get());
            threadPool.back()->signaler = std::move(worker);
            popErr.Dont();

            use = threadPool.begin() + threadPool.size() - 1;

            // Wait until available. A bit ugly but done once so no need to be complicated
            while(true) {
                {
                    std::unique_lock<std::mutex> lock(use->get()->mutex);
                    if(use->get()->state != Watcher::s_created) break;
                }
                std::this_thread::yield();
            }
        }

        auto &mangler(*use);
        std::unique_lock<std::mutex> specific(mangler->mutex);
        mangler->watch = add;
        mangler->wakeup = true;
        specific.unlock();
        mangler->cvar.notify_one();
    }

    //! Wait over the currently watched set of events, get out when at least one completes.
    //! Since we're gonna wait, I take the chance to remove dead/terminated threads.
    std::vector< std::pair<cl_event, cl_int> >&& operator()() {
        asizei assigned = 0; // this could be kept at watch, but I have to remove deads anyway so...
        for(asizei check = 0; check < threadPool.size(); check++) {
            std::unique_lock<std::mutex> lock(threadPool[check]->mutex); // a bit ugly
            switch(threadPool[check]->state) {
            case Watcher::s_terminated:
            case Watcher::s_dead:
                // terminated threads try pushing their events already...
                threadPool.erase(threadPool.begin() + check);
                check--;
                break;
            case Watcher::s_running:
                if(threadPool[check]->watch) assigned++;
                break;
            }
        }
        std::unique_lock<std::mutex> lock(collect.mutex);
        if(assigned && collect.triggered.empty()) collect.something.wait(lock, [this]() { return collect.triggered.size() != 0; });
        return std::move(collect.triggered);
    }

    void Shutdown() {
        std::vector<std::thread*> workers;
        {
            std::unique_lock<std::mutex> lock(collect.mutex);
            workers.reserve(threadPool.size());
            for(auto &thread : threadPool) {
                std::unique_lock<std::mutex> specific(thread->mutex);
                thread->keepGoing = false;
                thread->wakeup = true;
                thread->cvar.notify_one();
                workers.push_back(&thread->signaler);
            }
        }
        for(auto thread : workers) thread->join();
        //!< \todo Wow cool. Too bad we'll never be back from the dead if the events never trigger.
        //! This will likely be the case if the driver hangs... so what to do?
    }

private:
    /*! One of this is created for each event required to wake up. The idea is that a new one is created every time a new event enters the
    picture... unless we have already other threads available and not currently watching. How do they work?
    - New objects are created with an event to watch. The thread immediately goes to sleep on the newly created cvar.
    - For re-used threads, the signaler is already sleeping.
    In both cases, when cvar is signaled (non-spuriously) they look at keepGoing. If it's false they exit.
    Otherwise they clWaitEvents on their single event.
    When they wake up, they set the status to the CL status or errorcode in the shared triggered event list and set signal.
    The event this->wake is then cleared to zero, indicating the thread can be reused. */
    struct Watcher {
        std::thread signaler;
        cl_event watch; //!< if 0, the thread is available to look at something else and sleeping
        bool keepGoing; //!< RO to this->signaler. Will cause this->signaler to exit gracefully.
        bool wakeup; //!< this->signaler sets it to true providing a new watch or updating keepGoing.
        enum State {
            s_created,
            s_running,
            s_dead,
            s_terminated
        } state; //!< WO to this->signaler.
        std::condition_variable cvar;
        std::mutex mutex;
        explicit Watcher() : keepGoing(true), wakeup(false), state(s_created) { }
    private:
        Watcher(const Watcher &meh) = delete;
        Watcher& operator=(const Watcher &other) = delete;
    };


    /*! This is the "destination" of all our multithreaded nonsense. Threads put triggered events here and the thread calling (*this)() sleeps on this. */
    struct ThisCollector {
        std::mutex mutex;
        std::condition_variable something;
        std::vector< std::pair<cl_event, cl_int> > triggered;
    } collect;

    std::vector<std::unique_ptr<Watcher>> threadPool; //!< It seems C++11 spec suggests thread abstractions to be "as thin as possible" so better to keep those!

    static void __stdcall AsyncWatch(ThisCollector &collect, Watcher *self) {
        cl_event lastWait = 0;
        cl_int lastWaitError = 0;
        try {
            while(true) {
                cl_event waiting;
                {
                    std::unique_lock<std::mutex> lock(self->mutex);
                    self->state = self->s_running;
                    self->cvar.wait(lock, [self]() { return self->wakeup; });
                    self->wakeup = false;
                    if(self->keepGoing == false) break;
                    waiting = self->watch;
                }
                if(waiting) {
                    lastWait = waiting;
                    cl_int err = clWaitForEvents(1, &waiting);
                    if(err == CL_EXEC_STATUS_ERROR_FOR_EVENTS_IN_WAIT_LIST) {
                        lastWaitError = err;
                        cl_int pollErr = clGetEventInfo(waiting, CL_EVENT_COMMAND_EXECUTION_STATUS, sizeof(err), &err, NULL);
                        if(pollErr != CL_SUCCESS) {
                            lastWaitError = pollErr;
                            throw "I just give up.";
                        }
                    }
                    {
                        std::unique_lock<std::mutex> lock(collect.mutex);
                        collect.triggered.push_back(std::make_pair(waiting, err));
                        self->watch = 0;
                    }
                    collect.something.notify_one();
                }
            }
        } catch(...) {
            {
                std::unique_lock<std::mutex> lock(self->mutex);
                self->state = self->s_dead;
            }
            {
                std::unique_lock<std::mutex> lock(collect.mutex);
                collect.triggered.push_back(std::make_pair(lastWait, lastWaitError));
                self->watch = 0;
            }
            collect.something.notify_one();
        }
        if(self->state != self->s_dead) self->state = self->s_terminated;
    }

    // Noncopiable, nonmovable
    CLEventGuardian(const CLEventGuardian &other) = delete;
    CLEventGuardian(CLEventGuardian &&other) = delete;
    CLEventGuardian& operator=(const CLEventGuardian &other) = delete;
    CLEventGuardian& operator=(const CLEventGuardian &&other) = delete;
};
