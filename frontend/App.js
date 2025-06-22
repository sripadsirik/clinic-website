// frontend/App.js
import React, { useState, useEffect, useCallback } from 'react'
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  Keyboard,
} from 'react-native'
import Constants from 'expo-constants'
import { Picker } from '@react-native-picker/picker'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'

// Safely read expo.extra
const configExtra =
  (Constants.manifest  && Constants.manifest.extra)  ||
  (Constants.expoConfig && Constants.expoConfig.extra) ||
  {}
const {
  apiBaseDev  = 'http://192.168.68.79:4000',
  apiBaseProd = 'https://api.yourclinic.com',
} = configExtra
const API_BASE = __DEV__ ? apiBaseDev : apiBaseProd

function HomeScreen({ navigation }) {
  const [location,  setLocation]  = useState('Oak Lawn')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')

  const onFetch = useCallback(() => {
    const iso = /^\d{4}-\d{2}-\d{2}$/
    if (!iso.test(startDate) || !iso.test(endDate)) {
      Alert.alert('Invalid Dates', 'Please use YYYY-MM-DD format.')
      return
    }
    if (startDate > endDate) {
      Alert.alert('Invalid Range', 'Start date must be on or before end date.')
      return
    }
    Keyboard.dismiss()
    navigation.navigate('Results', { location, startDate, endDate })
  }, [location, startDate, endDate, navigation])

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.label}>Location</Text>
        <View style={styles.pickerWrapper}>
          <Picker selectedValue={location} onValueChange={setLocation}>
            {[
              'Oak Lawn',
              'Orland Park',
              'Albany Park',
              'Buffalo Grove',
              'OakBrook',
              'Schaumburg',
            ].map(loc => <Picker.Item key={loc} label={loc} value={loc} />)}
          </Picker>
        </View>

        <Text style={styles.label}>Start Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={startDate}
          onChangeText={setStartDate}
          placeholder="2025-06-18"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
        />

        <Text style={styles.label}>End Date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={endDate}
          onChangeText={setEndDate}
          placeholder="2025-06-19"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
        />

        <View style={styles.buttonWrapper}>
          <Button title="Fetch Visits" onPress={onFetch} />
        </View>
      </View>
    </SafeAreaView>
  )
}

function ResultsScreen({ route, navigation }) {
  const { location, startDate, endDate } = route.params
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]     = useState(null)

  // status filters per location
  const statusMap = {
    'Orland Park': ['MD Exit','OD Exit'],
    'Oak Lawn':    ['MD Exit','OD/Post-Op Exit'],
    'Albany Park': ['Exit'],
    'Buffalo Grove':['Exit'],
    'OakBrook':    ['Exit'],
    'Schaumburg':  ['Exit'],
  }
  const wantedStatuses = statusMap[location] || []

  const fetchVisits = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const qs  = new URLSearchParams({ location, startDate, endDate }).toString()
      const url = `${API_BASE}/api/visits?${qs}`
      console.log('🛠 Fetching →', url)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [location, startDate, endDate])

  useEffect(() => {
    if (startDate && endDate) fetchVisits()
  }, [fetchVisits])

  // build leaderboard
  const leaderboard = React.useMemo(() => {
    const counts = {}
    data.forEach(v => {
      if (wantedStatuses.includes(v.status) && v.doctor) {
        counts[v.doctor] = (counts[v.doctor]||0) + 1
      }
    })
    return Object.entries(counts)
      .map(([doctor,count])=>({doctor,count}))
      .sort((a,b)=>b.count-a.count)
  }, [data, wantedStatuses])

  if (!startDate||!endDate) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Missing date params.</Text>
        <Button title="Go Back" onPress={()=>navigation.goBack()} />
      </View>
    )
  }
  if (loading) return <ActivityIndicator style={styles.center} size="large" />
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Error: {error}</Text>
        <Button title="Retry" onPress={()=>{setLoading(true);fetchVisits()}}/>
      </View>
    )
  }
  if (data.length===0) {
    return (
      <View style={styles.center}>
        <Text>No visits from {startDate} to {endDate}.</Text>
        <Button title="Go Back" onPress={()=>navigation.goBack()}/>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.list}
      data={data}
      keyExtractor={item=>item._id}
      ListHeaderComponent={() => (
        <View style={styles.leaderboard}>
          <Text style={styles.leaderboardTitle}>Leaderboard</Text>
          {leaderboard.map((it,idx)=>(
            <Text key={it.doctor} style={styles.leaderboardItem}>
              {idx+1}. Dr {it.doctor}: {it.count} patient{it.count!==1?'s':''}
            </Text>
          ))}
        </View>
      )}
      refreshing={refreshing}
      onRefresh={()=>{setRefreshing(true);fetchVisits()}}
      renderItem={({item})=>(
        <View style={styles.item}>
          <Text style={styles.date}>
            {item.location} — {item.date} @ {item.time}
          </Text>
          <Text style={styles.detail}>
            {item.patient} • Dr {item.doctor||'—'} • {item.type||'—'}
          </Text>
          <Text style={styles.status}>{item.status||'—'}</Text>
        </View>
      )}
    />
  )
}

const Stack = createNativeStackNavigator()

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator 
        initialRouteName="Home" 
        screenOptions={{ headerTitleAlign:'center' }}
      >
        <Stack.Screen name="Home"    component={HomeScreen}    />
        <Stack.Screen name="Results" component={ResultsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  safe:            { flex:1, backgroundColor:'#fff' },
  container:       { flex:1, padding:16 },
  label:           { fontSize:16, marginVertical:8 },
  pickerWrapper:   { borderWidth:1, borderColor:'#ccc', borderRadius:4, marginBottom:16 },
  input:           { borderWidth:1, borderColor:'#ccc', borderRadius:4, padding:8, marginBottom:16 },
  buttonWrapper:   { marginVertical:16 },
  center:          { flex:1, justifyContent:'center', alignItems:'center' },
  error:           { color:'red', marginBottom:8 },
  list:            { backgroundColor:'#f9f9f9' },
  leaderboard:     { padding:12, backgroundColor:'#eef', margin:16, borderRadius:6 },
  leaderboardTitle:{ fontSize:18, fontWeight:'700', marginBottom:8 },
  leaderboardItem: { fontSize:16, marginVertical:2 },
  item:            {
                    backgroundColor:'#fff',
                    padding:12,
                    marginVertical:6,
                    marginHorizontal:16,
                    borderRadius:6,
                    shadowColor:'#000',
                    shadowOpacity:0.1,
                    shadowOffset:{width:0,height:1},
                    shadowRadius:2,
                    elevation:2,
                  },
  date:            { fontWeight:'600' },
  detail:          { marginTop:4, fontSize:14 },
  status:          { marginTop:4, fontStyle:'italic', color:'#555', fontSize:12 },
})
