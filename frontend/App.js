import 'react-native-gesture-handler';
import React, { useState, useEffect, useMemo } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Modal,
  Button,
  Platform,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LineChart } from 'react-native-chart-kit';

const API_BASE    = 'https://clinic-scraper.fly.dev';
const SCREEN_WIDTH = Dimensions.get('window').width - 32;

// full list (with “All”)
const LOCATIONS        = ['All','Oak Lawn','Orland Park','Albany Park','Buffalo Grove','OakBrook','Schaumburg'];
// comparison only: drop “All”
const LOCATIONS_NO_ALL = LOCATIONS.slice(1);

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PRESETS = {
  'Today':        () => { const d=new Date().toISOString().slice(0,10); return {startDate:d,endDate:d}; },
  'Yesterday':    () => { const d=new Date(); d.setDate(d.getDate()-1); const s=d.toISOString().slice(0,10); return {startDate:s,endDate:s}; },
  'Week To Date': () => {
    const now=new Date(), mon=new Date(now);
    mon.setDate(now.getDate() - ((now.getDay()+6)%7));
    return { startDate:mon.toISOString().slice(0,10), endDate:now.toISOString().slice(0,10) };
  },
  'Month To Date':() => {
    const now=new Date(), first=new Date(now.getFullYear(),now.getMonth(),1);
    return { startDate:first.toISOString().slice(0,10), endDate:now.toISOString().slice(0,10) };
  },
  'Year To Date': () => {
    const now=new Date(), first=new Date(now.getFullYear(),0,1);
    return { startDate:first.toISOString().slice(0,10), endDate:now.toISOString().slice(0,10) };
  },
};

const chartConfig = {
  backgroundGradientFrom: '#fff',
  backgroundGradientTo:   '#fff',
  decimalPlaces:          0,
  color:        (opacity=1) => `rgba(0,0,0,${opacity})`,
  labelColor:   (opacity=1) => `rgba(0,0,0,${opacity})`,
  style:               { borderRadius:12 },
  propsForDots:        { r:'4', strokeWidth:'2', stroke:'#000' },
};

const Tab = createBottomTabNavigator();

// —————————————————————————————————————————————————————————————————
// ModalDropdown: tap to open a picker in a modal
// —————————————————————————————————————————————————————————————————
function ModalDropdown({ label, options, selected, onChange }) {
  const [visible, setVisible] = useState(false);
  return <>
    <TouchableOpacity style={styles.selectorButton} onPress={()=>setVisible(true)}>
      <Text style={styles.selectorText}>{selected}</Text>
    </TouchableOpacity>
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{label}</Text>
          <Picker
            selectedValue={selected}
            onValueChange={v=>onChange(v)}
            style={styles.modalPicker}
          >
            {options.map(o=> <Picker.Item key={o} label={o} value={o}/> )}
          </Picker>
          <Button title="Done" onPress={()=>setVisible(false)} />
        </View>
      </View>
    </Modal>
  </>;
}

// —————————————————————————————————————————————————————————————————
// TimeRangePicker: tap to open presets/custom/month modal
// —————————————————————————————————————————————————————————————————
function TimeRangePicker({ startDate, endDate, onRangeChange }) {
  const [visible, setVisible]   = useState(false);
  const [mode, setMode]         = useState('Preset');
  const [preset, setPreset]     = useState('Today');
  const [custom, setCustom]     = useState({ start:new Date(), end:new Date() });
  const [monthYear, setMonth]   = useState({ month:new Date().getMonth(), year:new Date().getFullYear() });
  const [showDP, setShowDP]     = useState(null);

  // compute actual YYYY-MM-DDs
  const computed = useMemo(() => {
    if (mode==='Preset') return PRESETS[preset]();
    if (mode==='Custom') {
      return {
        startDate: custom.start.toISOString().slice(0,10),
        endDate:   custom.end  .toISOString().slice(0,10)
      };
    }
    const s = new Date(monthYear.year, monthYear.month, 1).toISOString().slice(0,10);
    const e = new Date(monthYear.year, monthYear.month+1, 0).toISOString().slice(0,10);
    return { startDate:s, endDate:e };
  }, [mode,preset,custom,monthYear]);

  useEffect(()=> onRangeChange(computed), [computed]);

  return <>
    <TouchableOpacity style={styles.selectorButton} onPress={()=>setVisible(true)}>
      <Text style={styles.selectorText}>{computed.startDate} → {computed.endDate}</Text>
    </TouchableOpacity>
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.modalOverlay}>
        <ScrollView contentContainerStyle={styles.modalCard}>
          <Text style={styles.modalTitle}>Select Range</Text>

          <Text style={styles.modalLabel}>Mode</Text>
          <Picker selectedValue={mode} onValueChange={setMode} style={styles.modalPicker}>
            {['Preset','Custom','ByMonth'].map(m=><Picker.Item key={m} label={m} value={m}/> )}
          </Picker>

          {mode==='Preset' && <>
            <Text style={styles.modalLabel}>Preset</Text>
            <Picker selectedValue={preset} onValueChange={setPreset} style={styles.modalPicker}>
              {Object.keys(PRESETS).map(p=><Picker.Item key={p} label={p} value={p}/> )}
            </Picker>
          </>}

          {mode==='ByMonth' && <>
            <Text style={styles.modalLabel}>Month</Text>
            <Picker selectedValue={monthYear.month} onValueChange={m=>setMonth(y=>({...y,month:m}))} style={styles.modalPicker}>
              {MONTH_NAMES.map((m,i)=><Picker.Item key={m} label={m} value={i}/> )}
            </Picker>
            <Text style={styles.modalLabel}>Year</Text>
            <Picker selectedValue={monthYear.year} onValueChange={y=>setMonth(m=>({...m,year:y}))} style={styles.modalPicker}>
              {[2023,2024,2025].map(y=><Picker.Item key={y} label={`${y}`} value={y}/> )}
            </Picker>
          </>}

          {mode==='Custom' && <>
            <Text style={styles.modalLabel}>Start</Text>
            <Button title={custom.start.toISOString().slice(0,10)} onPress={()=>setShowDP('start')} />
            <Text style={styles.modalLabel}>End</Text>
            <Button title={custom.end.toISOString().slice(0,10)}   onPress={()=>setShowDP('end')} />
            {showDP && (
              <DateTimePicker
                value={custom[showDP]}
                mode="date"
                display={Platform.OS==='ios'?'spinner':'calendar'}
                onChange={(_,d)=>{ setShowDP(null); if(d) setCustom(c=>({...c,[showDP]:d})); }}
              />
            )}
          </>}

          <View style={{marginTop:16}}>
            <Button title="Close" onPress={()=>setVisible(false)} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  </>;
}

// —————————————————————————————————————————————————————————————————
// Leaderboard Tab
// —————————————————————————————————————————————————————————————————
function LeaderboardScreen() {
  const [location, setLocation] = useState('All');
  const [range,    setRange]    = useState(PRESETS['Today']());
  const [data,     setData]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(()=>{
    (async()=>{
      setLoading(true); setError(null);
      try {
        const qs  = new URLSearchParams({ location, ...range }).toString();
        const res = await fetch(`${API_BASE}/api/leaderboard?${qs}`);
        if (!res.ok) throw new Error(res.status);
        setData(await res.json());
      } catch(e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [location,range]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <ModalDropdown label="Location" options={LOCATIONS} selected={location} onChange={setLocation}/>
        <TimeRangePicker startDate={range.startDate} endDate={range.endDate} onRangeChange={setRange}/>
      </View>
      {loading && <ActivityIndicator style={styles.center}/>}
      {error   && <Text style={styles.error}>Error: {error}</Text>}
      <ScrollView style={{flex:1}}>
        {data.map(g => (
          <View key={g.location} style={styles.card}>
            <Text style={styles.cardTitle}>{g.location}</Text>
            {g.leaderboard.length>0
              ? g.leaderboard.map((d,i)=>(<View key={d.doctor} style={styles.lbRow}>
                  <Text style={styles.lbIndex}>{i+1}.</Text>
                  <Text style={styles.lbDoctor}>Dr {d.doctor}</Text>
                  <Text style={styles.lbCount}>{d.count}</Text>
                </View>))
              : <Text style={styles.noData}>No data</Text>
            }
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// —————————————————————————————————————————————————————————————————
// KPIs Tab
// —————————————————————————————————————————————————————————————————
function KPIsScreen() {
  const [location, setLocation] = useState('All');
  const [range,    setRange]    = useState(PRESETS['Today']());
  const [kpiType,  setKpiType]  = useState('location');
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(()=>{
    (async()=>{
      setLoading(true); setError(null);
      try {
        const qs  = new URLSearchParams({ location, ...range }).toString();
        const res = await fetch(`${API_BASE}/api/kpis?${qs}`);
        if (!res.ok) throw new Error(res.status);
        setData(await res.json());
      } catch(e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [location,range]);

  if (loading) return <ActivityIndicator style={styles.center}/>;
  if (error)   return <Text style={styles.error}>Error: {error}</Text>;
  if (!data)   return null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <ModalDropdown label="Location"    options={LOCATIONS} selected={location} onChange={setLocation}/>
        <TimeRangePicker startDate={range.startDate} endDate={range.endDate} onRangeChange={setRange}/>
      </View>
      <ModalDropdown label="KPI Type" options={['location','doctor']} selected={kpiType} onChange={setKpiType}/>
      <ScrollView style={{flex:1}}>
        {kpiType==='location' ? (
          data.byLocation.map(l => {
            const max = Math.max(...data.byLocation.map(x=>x.patientsSeen),1);
            const pct = (l.patientsSeen/max)*100;
            return (
              <View key={l.location} style={styles.card}>
                <Text style={styles.cardTitle}>{l.location}</Text>
                <View style={styles.barWrapper}>
                  <View style={[styles.barFill,{flex:pct}]} />
                  <View style={{flex:100-pct}}/>
                </View>
                <Text style={styles.lbCount}>{l.patientsSeen}</Text>
              </View>
            );
          })
        ) : (
          data.byDoctor.map(g => (
            <View key={g.location} style={styles.card}>
              <Text style={styles.cardTitle}>By Dr — {g.location}</Text>
              {g.perDoctor.map(d => {
                const max = g.perDoctor[0]?.count||1;
                const pct = (d.count/max)*100;
                return (
                  <View key={d.doctor} style={styles.barRow}>
                    <Text style={styles.lbDoctor}>Dr {d.doctor}</Text>
                    <View style={styles.barWrapper}>
                      <View style={[styles.barFill,{flex:pct}]} />
                      <View style={{flex:100-pct}}/>
                    </View>
                    <Text style={styles.lbCount}>{d.count}</Text>
                  </View>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// —————————————————————————————————————————————————————————————————
// Comparison Tab
// —————————————————————————————————————————————————————————————————
function ComparisonScreen() {
  const [location, setLocation] = useState(LOCATIONS_NO_ALL[0]);
  const [range,    setRange]    = useState(PRESETS['Year To Date']());
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(()=>{
    (async()=>{
      setLoading(true); setError(null);
      try {
        const qs  = new URLSearchParams({ location, ...range }).toString();
        const res = await fetch(`${API_BASE}/api/comparison?${qs}`);
        if (!res.ok) throw new Error(res.status);
        setData(await res.json());
      } catch(e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [location,range]);

  if (loading) return <ActivityIndicator style={styles.center}/>;
  if (error)   return <Text style={styles.error}>Error: {error}</Text>;
  if (!data)   return null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerRow}>
        <ModalDropdown label="Location" options={LOCATIONS_NO_ALL} selected={location} onChange={setLocation}/>
      </View>
      <Text style={styles.cardTitle}>Year-to-Date Comparison</Text>
      <LineChart
        data={{
          labels: data.months,
          datasets:[
            { data:data.thisYear, color:()=> 'tomato', strokeWidth:2 },
            { data:data.lastYear, color:()=> 'steelblue', strokeWidth:2 },
          ],
          legend:['This Year','Last Year'],
        }}
        width={SCREEN_WIDTH} height={220}
        chartConfig={chartConfig}
        style={styles.chart}
      />
    </SafeAreaView>
  );
}

// —————————————————————————————————————————————————————————————————
export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerTitleAlign:'center',
          tabBarActiveTintColor:'tomato',
          tabBarInactiveTintColor:'#888',
        }}
      >
        <Tab.Screen name="Leaderboard" component={LeaderboardScreen}/>
        <Tab.Screen name="KPIs"        component={KPIsScreen}/>
        <Tab.Screen name="Comparison"  component={ComparisonScreen}/>
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  safe: { flex:1, backgroundColor:'#f5f5f5' },
  center:{ flex:1, justifyContent:'center', alignItems:'center' },

  headerRow: {
    flexDirection:'row',
    padding:12,
    justifyContent:'space-between',
  },

  selectorButton: {
    flex:1,
    marginHorizontal:4,
    padding:12,
    backgroundColor:'#fff',
    borderRadius:8,
    shadowColor:'#000',
    shadowOpacity:0.05,
    shadowOffset:{width:0,height:2},
    shadowRadius:4,
    elevation:2,
  },
  selectorText: {
    fontSize:14,
    color:'#333',
    textAlign:'center',
  },

  modalOverlay: {
    flex:1,
    backgroundColor:'rgba(0,0,0,0.25)',
    justifyContent:'center',
    padding:24,
  },
  modalCard: {
    backgroundColor:'#fff',
    borderRadius:12,
    padding:16,
    shadowColor:'#000',
    shadowOpacity:0.1,
    shadowOffset:{width:0,height:4},
    shadowRadius:8,
    elevation:4,
  },
  modalTitle: {
    fontSize:18,
    fontWeight:'700',
    marginBottom:12,
    textAlign:'center',
  },
  modalLabel: {
    marginTop:8,
    fontSize:14,
    color:'#555',
  },
  modalPicker: {
    marginVertical:4,
  },

  card: {
    marginHorizontal:12,
    marginVertical:8,
    backgroundColor:'#fff',
    borderRadius:12,
    padding:16,
    shadowColor:'#000',
    shadowOpacity:0.05,
    shadowOffset:{width:0,height:2},
    shadowRadius:4,
    elevation:2,
  },
  cardTitle: {
    fontSize:18,
    fontWeight:'700',
    marginBottom:8,
  },

  lbRow:       { flexDirection:'row', alignItems:'center', marginVertical:4 },
  lbIndex:     { width:20, fontSize:16, color:'tomato', fontWeight:'700' },
  lbDoctor:    { flex:1, fontSize:16, color:'#333' },
  lbCount:     { fontSize:16, color:'green', fontWeight:'700' },
  noData:      { fontSize:14, color:'#888', textAlign:'center', paddingVertical:8 },

  barWrapper:  { flexDirection:'row', height:16, borderRadius:8, overflow:'hidden', marginVertical:8 },
  barFill:     { backgroundColor:'#4caf50' },
  barRow:      { marginVertical:4 },

  chart:       { marginHorizontal:16, marginVertical:16, borderRadius:12 },

  error:       { color:'red', textAlign:'center', margin:16 },
});
